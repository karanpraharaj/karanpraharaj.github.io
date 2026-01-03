/**
 * Slack Photo Uploader - Cloudflare Worker
 * 
 * Receives Slack events when photos are uploaded to a channel,
 * then commits them to GitHub for the photography page.
 * 
 * Message format: Caption | Location | YYYY-MM-DD
 * Example: "Temple at dawn | Kyoto, Japan | 2024-01-15"
 */

export default {
  async fetch(request, env) {
    // Handle GET requests (health check)
    if (request.method === 'GET') {
      return new Response('Slack Photo Uploader is running!', { status: 200 });
    }

    // Only accept POST requests
    if (request.method !== 'POST') {
      return new Response('Method not allowed', { status: 405 });
    }

    try {
      const text = await request.text();
      console.log('Received:', text);

      const body = JSON.parse(text);

      // Handle Slack URL verification challenge
      if (body.type === 'url_verification') {
        console.log('Challenge received:', body.challenge);
        return new Response(JSON.stringify({ challenge: body.challenge }), {
          headers: { 'Content-Type': 'application/json' }
        });
      }

      // Handle event callbacks
      if (body.type === 'event_callback') {
        const event = body.event;

        // Handle text-only messages (for DELETE commands)
        if (event.type === 'message' && event.text && !event.files) {
          const text = event.text.trim();

          // Check for DELETE command: "DELETE | filename.jpg"
          if (text.toUpperCase().startsWith('DELETE')) {
            const parts = text.split('|').map(s => s.trim());
            if (parts.length >= 2) {
              const filename = parts[1];
              await deletePhoto(filename, env);
              console.log(`Deleted: ${filename}`);
              return new Response('Deleted', { status: 200 });
            }
          }
          return new Response('OK', { status: 200 });
        }

        // Only process messages with files (photos)
        if (event.type === 'message' && event.files && event.files.length > 0) {
          // Filter for image files only
          const imageFiles = event.files.filter(f =>
            f.mimetype && f.mimetype.startsWith('image/')
          );

          if (imageFiles.length === 0) {
            return new Response('No images found', { status: 200 });
          }

          // Parse caption from message text
          // Format: Caption | Location | YYYY-MM-DD
          const messageText = event.text || '';
          const parsed = parseCaption(messageText);

          // Process each image
          for (const file of imageFiles) {
            await processImage(file, parsed, env);
          }

          return new Response('OK', { status: 200 });
        }
      }

      return new Response('OK', { status: 200 });

    } catch (error) {
      console.error('Error:', error);
      return new Response('Error: ' + error.message, { status: 500 });
    }
  }
};

/**
 * Parse caption from Slack message
 * Format: "Caption | Location | YYYY-MM-DD"
 */
function parseCaption(text) {
  const parts = text.split('|').map(s => s.trim());

  return {
    caption: parts[0] || 'Untitled',
    location: parts[1] || 'Unknown',
    date: parts[2] || new Date().toISOString().split('T')[0]
  };
}

/**
 * Download image from Slack, upload to GitHub
 */
async function processImage(file, metadata, env) {
  // Download image from Slack
  const imageResponse = await fetch(file.url_private_download, {
    headers: {
      'Authorization': `Bearer ${env.SLACK_BOT_TOKEN}`
    }
  });

  if (!imageResponse.ok) {
    throw new Error('Failed to download image from Slack');
  }

  const imageBuffer = await imageResponse.arrayBuffer();

  // Chunked base64 encoding to avoid stack overflow on large images
  const bytes = new Uint8Array(imageBuffer);
  let binary = '';
  const chunkSize = 8192;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode.apply(null, chunk);
  }
  const imageBase64 = btoa(binary);

  // Generate filename from original or create one
  const extension = file.filetype || 'jpg';
  const sanitizedCaption = metadata.caption
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .substring(0, 50);
  const filename = `${sanitizedCaption}-${metadata.date}.${extension}`;

  // Upload image to GitHub
  await uploadToGitHub(
    `photos/img/${filename}`,
    imageBase64,
    `feat: Add photo - ${metadata.caption}`,
    env
  );

  // Update photos.json
  await updatePhotosJson(filename, metadata, env);

  console.log(`Successfully uploaded: ${filename}`);
}

/**
 * Upload a file to GitHub via API
 */
async function uploadToGitHub(path, contentBase64, message, env) {
  const url = `https://api.github.com/repos/${env.GITHUB_REPO}/contents/${path}`;

  // Check if file already exists (need SHA to update)
  let sha = null;
  const checkResponse = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${env.GITHUB_TOKEN}`,
      'User-Agent': 'Slack-Photo-Uploader'
    }
  });

  if (checkResponse.ok) {
    const existingFile = await checkResponse.json();
    sha = existingFile.sha;
    console.log(`File exists, will update with sha: ${sha}`);
  }

  const body = {
    message: message,
    content: contentBase64,
    branch: env.GITHUB_BRANCH
  };

  if (sha) {
    body.sha = sha;
  }

  const response = await fetch(url, {
    method: 'PUT',
    headers: {
      'Authorization': `Bearer ${env.GITHUB_TOKEN}`,
      'Content-Type': 'application/json',
      'User-Agent': 'Slack-Photo-Uploader'
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`GitHub upload failed: ${error}`);
  }

  return response.json();
}

/**
 * Update photos.json with new photo entry
 */
async function updatePhotosJson(filename, metadata, env) {
  const path = 'photos/photos.json';
  const url = `https://api.github.com/repos/${env.GITHUB_REPO}/contents/${path}`;

  // Get current photos.json
  const getResponse = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${env.GITHUB_TOKEN}`,
      'User-Agent': 'Slack-Photo-Uploader'
    }
  });

  let photos = [];
  let sha = null;

  if (getResponse.ok) {
    const data = await getResponse.json();
    sha = data.sha;
    const content = atob(data.content);
    photos = JSON.parse(content);
  }

  // Add new photo entry
  photos.push({
    file: filename,
    caption: metadata.caption,
    location: metadata.location,
    date: metadata.date
  });

  // Sort by date (newest first)
  photos.sort((a, b) => new Date(b.date) - new Date(a.date));

  // Upload updated photos.json
  const newContent = btoa(JSON.stringify(photos, null, 2));

  const putResponse = await fetch(url, {
    method: 'PUT',
    headers: {
      'Authorization': `Bearer ${env.GITHUB_TOKEN}`,
      'Content-Type': 'application/json',
      'User-Agent': 'Slack-Photo-Uploader'
    },
    body: JSON.stringify({
      message: `feat: Update photos.json with ${metadata.caption}`,
      content: newContent,
      sha: sha,
      branch: env.GITHUB_BRANCH
    })
  });

  if (!putResponse.ok) {
    const error = await putResponse.text();
    throw new Error(`Failed to update photos.json: ${error}`);
  }

  return putResponse.json();
}

/**
 * Delete a photo from GitHub (both image and JSON entry)
 */
async function deletePhoto(filename, env) {
  // 1. Delete the image file
  const imageUrl = `https://api.github.com/repos/${env.GITHUB_REPO}/contents/photos/img/${filename}`;

  const imageResponse = await fetch(imageUrl, {
    headers: {
      'Authorization': `Bearer ${env.GITHUB_TOKEN}`,
      'User-Agent': 'Slack-Photo-Uploader'
    }
  });

  if (imageResponse.ok) {
    const imageData = await imageResponse.json();

    await fetch(imageUrl, {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${env.GITHUB_TOKEN}`,
        'Content-Type': 'application/json',
        'User-Agent': 'Slack-Photo-Uploader'
      },
      body: JSON.stringify({
        message: `feat: Delete photo ${filename}`,
        sha: imageData.sha,
        branch: env.GITHUB_BRANCH
      })
    });
    console.log(`Deleted image: ${filename}`);
  } else {
    console.log(`Image not found: ${filename}`);
  }

  // 2. Update photos.json to remove the entry
  const jsonUrl = `https://api.github.com/repos/${env.GITHUB_REPO}/contents/photos/photos.json`;

  const jsonResponse = await fetch(jsonUrl, {
    headers: {
      'Authorization': `Bearer ${env.GITHUB_TOKEN}`,
      'User-Agent': 'Slack-Photo-Uploader'
    }
  });

  if (jsonResponse.ok) {
    const jsonData = await jsonResponse.json();
    const content = atob(jsonData.content);
    let photos = JSON.parse(content);

    // Remove the entry with matching filename
    const originalLength = photos.length;
    photos = photos.filter(p => p.file !== filename);

    if (photos.length < originalLength) {
      const newContent = btoa(JSON.stringify(photos, null, 2));

      await fetch(jsonUrl, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${env.GITHUB_TOKEN}`,
          'Content-Type': 'application/json',
          'User-Agent': 'Slack-Photo-Uploader'
        },
        body: JSON.stringify({
          message: `feat: Remove ${filename} from photos.json`,
          content: newContent,
          sha: jsonData.sha,
          branch: env.GITHUB_BRANCH
        })
      });
      console.log(`Removed from photos.json: ${filename}`);
    }
  }
}
