/**
 * Embedding Space Explorer - 3D Visualization
 * Three.js powered immersive document embedding explorer
 */

// ============================================
// Configuration
// ============================================
const CONFIG = {
    particleSize: 0.15,
    particleSegments: 16,
    cameraDistance: 25,
    rotationSpeed: 0.0003,
    transitionDuration: 1500,
    neighborCount: 5,
    colors: {
        department: {
            'Legal': 0x00f5ff,      // Cyan
            'Trading': 0xff00ff,    // Magenta
            'Executive': 0xbf00ff,  // Purple
            'Finance': 0x00ff80,    // Green
            'Operations': 0xff8000, // Orange
            'Other': 0x0080ff      // Blue
        },
        topic: {
            'Energy Markets': 0x00f5ff,
            'Legal/Contracts': 0xff00ff,
            'Internal Comms': 0xbf00ff,
            'Financial': 0x00ff80,
            'Technical': 0xff8000,
            'Personal': 0xffff00
        },
        sender: {}
    }
};

// ============================================
// State
// ============================================
const state = {
    data: null,
    currentModel: 'minilm',
    colorBy: 'department',
    selectedIndex: null,
    hoveredIndex: null,
    particles: [],
    particleGroup: null,
    connectionLines: null,
    isAnimating: false
};

// Three.js globals
let scene, camera, renderer, controls;
let raycaster, mouse;

// ============================================
// Initialize
// ============================================
async function init() {
    try {
        // Load data
        const response = await fetch('data/embeddings.json');
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        state.data = await response.json();

        // Generate sender colors
        const senders = [...new Set(state.data.emails.map(e => e.sender))];
        const hueStep = 360 / senders.length;
        senders.forEach((sender, i) => {
            const hue = i * hueStep;
            CONFIG.colors.sender[sender] = new THREE.Color(`hsl(${hue}, 100%, 60%)`).getHex();
        });

        // Initialize Three.js
        initThree();
        createParticles();
        createLegend();
        setupEventListeners();
        animate();

        // Hide loading screen
        setTimeout(() => {
            document.getElementById('loading').classList.add('hidden');
        }, 500);

    } catch (error) {
        console.error('Failed to initialize:', error);
        document.querySelector('.loading-overlay p').textContent = 'Failed to load. Please refresh.';
    }
}

// ============================================
// Three.js Setup
// ============================================
function initThree() {
    const container = document.getElementById('canvas-container');
    const rect = container.getBoundingClientRect();

    // Scene
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0a0a0f);
    scene.fog = new THREE.FogExp2(0x0a0a0f, 0.015);

    // Camera - use container dimensions
    camera = new THREE.PerspectiveCamera(60, rect.width / rect.height, 0.1, 1000);
    camera.position.z = CONFIG.cameraDistance;

    // Renderer - use container dimensions
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(rect.width, rect.height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.appendChild(renderer.domElement);

    // Controls
    controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.rotateSpeed = 0.5;
    controls.zoomSpeed = 0.8;
    controls.minDistance = 5;
    controls.maxDistance = 50;
    controls.autoRotate = true;
    controls.autoRotateSpeed = 0.5;

    // Raycaster for interaction
    raycaster = new THREE.Raycaster();
    raycaster.params.Points.threshold = 0.3;
    mouse = new THREE.Vector2();

    // Ambient light
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.3);
    scene.add(ambientLight);

    // Point light at camera
    const pointLight = new THREE.PointLight(0xffffff, 0.5);
    camera.add(pointLight);
    scene.add(camera);

    // Grid helper
    const gridHelper = new THREE.GridHelper(30, 30, 0x3a3a50, 0x2a2a40);
    gridHelper.position.y = -8;
    scene.add(gridHelper);

    // Handle resize
    window.addEventListener('resize', onWindowResize);
}

function onWindowResize() {
    const container = document.getElementById('canvas-container');
    const rect = container.getBoundingClientRect();
    camera.aspect = rect.width / rect.height;
    camera.updateProjectionMatrix();
    renderer.setSize(rect.width, rect.height);
}

// ============================================
// Particles
// ============================================
function createParticles() {
    state.particleGroup = new THREE.Group();
    scene.add(state.particleGroup);

    const embeddings = state.data.embeddings[state.currentModel];

    // Normalize positions
    const positions = normalizePositions(embeddings);

    // Create particles
    state.data.emails.forEach((email, i) => {
        const color = getColor(email);
        const geometry = new THREE.SphereGeometry(CONFIG.particleSize, CONFIG.particleSegments, CONFIG.particleSegments);

        // Create glowing material
        const material = new THREE.MeshBasicMaterial({
            color: color,
            transparent: true,
            opacity: 0.9
        });

        const particle = new THREE.Mesh(geometry, material);
        particle.position.set(positions[i][0], positions[i][1], positions[i][2]);
        particle.userData = { index: i, email: email, baseColor: color };

        // Add glow
        const glowGeometry = new THREE.SphereGeometry(CONFIG.particleSize * 1.5, 16, 16);
        const glowMaterial = new THREE.MeshBasicMaterial({
            color: color,
            transparent: true,
            opacity: 0.3
        });
        const glow = new THREE.Mesh(glowGeometry, glowMaterial);
        particle.add(glow);

        state.particleGroup.add(particle);
        state.particles.push(particle);
    });
}

function normalizePositions(embeddings) {
    // Add z-coordinate (use first two dims or generate)
    const positions = embeddings.map((pos, i) => {
        // Create z from a hash of the position or use variation
        const z = Math.sin(pos[0] * 2) * Math.cos(pos[1] * 2) * 3;
        return [pos[0], pos[1], z];
    });

    // Find bounds
    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;
    let minZ = Infinity, maxZ = -Infinity;

    positions.forEach(pos => {
        minX = Math.min(minX, pos[0]);
        maxX = Math.max(maxX, pos[0]);
        minY = Math.min(minY, pos[1]);
        maxY = Math.max(maxY, pos[1]);
        minZ = Math.min(minZ, pos[2]);
        maxZ = Math.max(maxZ, pos[2]);
    });

    // Normalize to [-10, 10] range
    const scale = 10;
    return positions.map(pos => [
        ((pos[0] - minX) / (maxX - minX) - 0.5) * 2 * scale,
        ((pos[1] - minY) / (maxY - minY) - 0.5) * 2 * scale,
        ((pos[2] - minZ) / (maxZ - minZ) - 0.5) * 2 * scale * 0.5
    ]);
}

function updateParticlePositions() {
    if (state.isAnimating) return;
    state.isAnimating = true;

    const embeddings = state.data.embeddings[state.currentModel];
    const newPositions = normalizePositions(embeddings);

    // Animate each particle to new position
    state.particles.forEach((particle, i) => {
        const startPos = particle.position.clone();
        const endPos = new THREE.Vector3(newPositions[i][0], newPositions[i][1], newPositions[i][2]);

        animatePosition(particle, startPos, endPos, CONFIG.transitionDuration);
    });

    setTimeout(() => {
        state.isAnimating = false;
    }, CONFIG.transitionDuration);
}

function animatePosition(object, start, end, duration) {
    const startTime = Date.now();

    function update() {
        const elapsed = Date.now() - startTime;
        const progress = Math.min(elapsed / duration, 1);

        // Easing function (ease out cubic)
        const eased = 1 - Math.pow(1 - progress, 3);

        object.position.lerpVectors(start, end, eased);

        if (progress < 1) {
            requestAnimationFrame(update);
        }
    }

    update();
}

function updateParticleColors() {
    state.particles.forEach((particle, i) => {
        const email = state.data.emails[i];
        const newColor = getColor(email);

        particle.material.color.setHex(newColor);
        particle.children[0].material.color.setHex(newColor); // Glow
        particle.userData.baseColor = newColor;
    });

    createLegend();
}

function getColor(email) {
    const colorMap = CONFIG.colors[state.colorBy];
    const key = email[state.colorBy] || 'Other';
    return colorMap[key] || 0x0080ff;
}

// ============================================
// Connections / Lines
// ============================================
function showConnections(selectedIndex) {
    // Remove existing lines
    if (state.connectionLines) {
        scene.remove(state.connectionLines);
        state.connectionLines.geometry.dispose();
        state.connectionLines.material.dispose();
    }

    const neighbors = findNearestNeighbors(selectedIndex, CONFIG.neighborCount);
    const selectedPos = state.particles[selectedIndex].position;

    const points = [];
    neighbors.forEach(n => {
        points.push(selectedPos.clone());
        points.push(state.particles[n.index].position.clone());
    });

    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    const material = new THREE.LineBasicMaterial({
        color: 0x00f5ff,
        transparent: true,
        opacity: 0.4
    });

    state.connectionLines = new THREE.LineSegments(geometry, material);
    scene.add(state.connectionLines);

    // Highlight neighbors
    state.particles.forEach((p, i) => {
        if (i === selectedIndex) {
            p.scale.setScalar(2);
            p.material.opacity = 1;
        } else if (neighbors.some(n => n.index === i)) {
            p.scale.setScalar(1.5);
            p.material.opacity = 0.9;
        } else {
            p.scale.setScalar(1);
            p.material.opacity = 0.3;
        }
    });
}

function clearConnections() {
    if (state.connectionLines) {
        scene.remove(state.connectionLines);
        state.connectionLines = null;
    }

    state.particles.forEach(p => {
        p.scale.setScalar(1);
        p.material.opacity = 0.9;
    });
}

// ============================================
// Nearest Neighbors
// ============================================
function findNearestNeighbors(index, count) {
    const targetPos = state.particles[index].position;

    const distances = state.particles.map((p, i) => ({
        index: i,
        email: state.data.emails[i],
        distance: targetPos.distanceTo(p.position)
    }));

    const nearest = distances
        .filter(d => d.index !== index)
        .sort((a, b) => a.distance - b.distance)
        .slice(0, count);

    const maxDist = Math.max(...nearest.map(n => n.distance));
    return nearest.map(n => ({
        ...n,
        similarity: 1 - (n.distance / maxDist)
    }));
}

// ============================================
// Legend
// ============================================
function createLegend() {
    const container = document.getElementById('legend');
    if (!container) return;
    container.innerHTML = '';

    const colorMap = CONFIG.colors[state.colorBy];

    Object.entries(colorMap).forEach(([label, colorHex]) => {
        const color = typeof colorHex === 'number' ? `#${colorHex.toString(16).padStart(6, '0')}` : colorHex;

        const item = document.createElement('div');
        item.className = 'legend-item';
        item.innerHTML = `
            <span class="legend-dot" style="background: ${color}; color: ${color}"></span>
            <span class="legend-label">${label}</span>
        `;
        container.appendChild(item);
    });
}

// ============================================
// Interactions
// ============================================
function onMouseMove(event) {
    const container = document.getElementById('canvas-container');
    const rect = container.getBoundingClientRect();
    const tooltip = document.getElementById('tooltip');

    // Check if mouse is over the visualization container
    const isOverCanvas = (
        event.clientX >= rect.left &&
        event.clientX <= rect.right &&
        event.clientY >= rect.top &&
        event.clientY <= rect.bottom
    );

    if (!isOverCanvas) {
        // Hide tooltip when not over canvas
        if (state.hoveredIndex !== null && state.hoveredIndex !== state.selectedIndex) {
            state.particles[state.hoveredIndex].scale.setScalar(1);
        }
        state.hoveredIndex = null;
        tooltip.classList.remove('visible');
        return;
    }

    // Calculate mouse position relative to the canvas container
    mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    raycaster.setFromCamera(mouse, camera);
    const intersects = raycaster.intersectObjects(state.particles);

    if (intersects.length > 0) {
        const particle = intersects[0].object;
        const email = particle.userData.email;
        const index = particle.userData.index;

        // Hover effect
        if (state.hoveredIndex !== index && state.selectedIndex !== index) {
            // Reset previous hover
            if (state.hoveredIndex !== null && state.hoveredIndex !== state.selectedIndex) {
                state.particles[state.hoveredIndex].scale.setScalar(1);
            }
            particle.scale.setScalar(1.5);
            state.hoveredIndex = index;
        }

        // Show tooltip
        tooltip.innerHTML = `
            <div class="tooltip-subject">${email.subject || '(No subject)'}</div>
            <div class="tooltip-meta">From: ${email.sender} · ${email.date}</div>
            <div class="tooltip-preview">${truncate(email.body, 120)}</div>
        `;
        tooltip.style.left = `${event.clientX + 20}px`;
        tooltip.style.top = `${event.clientY + 20}px`;
        tooltip.classList.add('visible');

        document.body.style.cursor = 'pointer';
    } else {
        // Reset hover
        if (state.hoveredIndex !== null && state.hoveredIndex !== state.selectedIndex) {
            const wasSelected = state.selectedIndex !== null;
            state.particles[state.hoveredIndex].scale.setScalar(wasSelected ? (state.hoveredIndex === state.selectedIndex ? 2 : 1) : 1);
        }
        state.hoveredIndex = null;
        tooltip.classList.remove('visible');
        document.body.style.cursor = 'grab';
    }
}

function onClick(event) {
    const container = document.getElementById('canvas-container');
    const rect = container.getBoundingClientRect();

    // Only handle clicks inside the visualization
    const isOverCanvas = (
        event.clientX >= rect.left &&
        event.clientX <= rect.right &&
        event.clientY >= rect.top &&
        event.clientY <= rect.bottom
    );

    if (!isOverCanvas) return;

    raycaster.setFromCamera(mouse, camera);
    const intersects = raycaster.intersectObjects(state.particles);

    if (intersects.length > 0) {
        const particle = intersects[0].object;
        const index = particle.userData.index;
        const email = particle.userData.email;

        state.selectedIndex = index;

        // Show connections
        showConnections(index);

        // Show detail panel
        showDetailPanel(email, index);

        // Stop auto-rotate when selected
        controls.autoRotate = false;
    }
}

// ============================================
// Detail Panel
// ============================================
function showDetailPanel(email, index) {
    const panel = document.getElementById('detail-panel');
    const neighbors = findNearestNeighbors(index, CONFIG.neighborCount);

    panel.innerHTML = `
        <div class="detail-header">
            <h3>${email.subject || '(No subject)'}</h3>
            <div class="detail-meta">
                <span><strong>From:</strong> ${email.sender}</span>
                <span><strong>To:</strong> ${email.to || 'N/A'}</span>
                <span><strong>Date:</strong> ${email.date}</span>
                <span><strong>Department:</strong> ${email.department}</span>
                <span><strong>Topic:</strong> ${email.topic}</span>
            </div>
        </div>
        <div class="detail-body">${email.body}</div>
        <div class="neighbors-section">
            <h4>Nearest Neighbors</h4>
            ${neighbors.map(n => `
                <div class="neighbor-item" data-index="${n.index}">
                    <div class="neighbor-subject">${n.email.subject || '(No subject)'}</div>
                    <div class="neighbor-score">Similarity: ${(n.similarity * 100).toFixed(1)}%</div>
                </div>
            `).join('')}
        </div>
    `;

    // Add click handlers to neighbors
    panel.querySelectorAll('.neighbor-item').forEach(item => {
        item.addEventListener('click', () => {
            const neighborIndex = parseInt(item.dataset.index);
            const neighborEmail = state.data.emails[neighborIndex];
            state.selectedIndex = neighborIndex;
            showConnections(neighborIndex);
            showDetailPanel(neighborEmail, neighborIndex);

            // Animate camera to look at selected point
            const targetPos = state.particles[neighborIndex].position;
            animateCameraTarget(targetPos);
        });
    });

}

function hideDetailPanel() {
    const panel = document.getElementById('detail-panel');
    panel.innerHTML = `
        <div class="detail-placeholder">
            <p>Click on any point to see email details and nearest neighbors.</p>
        </div>
    `;
    state.selectedIndex = null;
    clearConnections();
    controls.autoRotate = true;
}

function animateCameraTarget(target) {
    const startTarget = controls.target.clone();
    const endTarget = target.clone();
    const duration = 800;
    const startTime = Date.now();

    function update() {
        const elapsed = Date.now() - startTime;
        const progress = Math.min(elapsed / duration, 1);
        const eased = 1 - Math.pow(1 - progress, 3);

        controls.target.lerpVectors(startTarget, endTarget, eased);

        if (progress < 1) {
            requestAnimationFrame(update);
        }
    }

    update();
}

// ============================================
// Search
// ============================================
function handleSearch() {
    const query = document.getElementById('search-input').value.trim().toLowerCase();
    if (!query) {
        clearConnections();
        state.particles.forEach(p => {
            p.material.opacity = 0.9;
            p.scale.setScalar(1);
        });
        return;
    }

    // Find matching emails
    const matches = state.data.emails
        .map((email, index) => ({ email, index, score: searchScore(email, query) }))
        .filter(m => m.score > 0)
        .sort((a, b) => b.score - a.score);

    // Highlight matches
    state.particles.forEach((p, i) => {
        const match = matches.find(m => m.index === i);
        if (match) {
            p.material.opacity = 1;
            p.scale.setScalar(1.5 + match.score * 0.3);
        } else {
            p.material.opacity = 0.15;
            p.scale.setScalar(1);
        }
    });

    // Focus on first match
    if (matches.length > 0) {
        const firstMatch = matches[0];
        state.selectedIndex = firstMatch.index;
        showDetailPanel(firstMatch.email, firstMatch.index);
        animateCameraTarget(state.particles[firstMatch.index].position);
    }
}

function searchScore(email, query) {
    let score = 0;
    if (email.subject?.toLowerCase().includes(query)) score += 3;
    if (email.body?.toLowerCase().includes(query)) score += 1;
    if (email.sender?.toLowerCase().includes(query)) score += 2;
    return score;
}

// ============================================
// Event Listeners
// ============================================
function setupEventListeners() {
    // Mouse interactions
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('click', onClick);

    // Search
    document.getElementById('search-btn').addEventListener('click', handleSearch);
    document.getElementById('search-input').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') handleSearch();
    });

    // Color by
    document.getElementById('color-by').addEventListener('change', (e) => {
        state.colorBy = e.target.value;
        updateParticleColors();
    });

    // Model select
    document.getElementById('model-select').addEventListener('change', (e) => {
        state.currentModel = e.target.value;
        updateParticlePositions();
        clearConnections();
        hideDetailPanel();
    });

    // Keyboard
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            hideDetailPanel();
        }
    });
}

// ============================================
// Animation Loop
// ============================================
function animate() {
    requestAnimationFrame(animate);

    controls.update();

    // Subtle particle pulse
    const time = Date.now() * 0.001;
    state.particles.forEach((p, i) => {
        if (state.selectedIndex === null || state.selectedIndex === i) {
            const pulse = 1 + Math.sin(time * 2 + i * 0.5) * 0.05;
            p.children[0].scale.setScalar(pulse);
        }
    });

    renderer.render(scene, camera);
}

// ============================================
// Utilities
// ============================================
function truncate(text, maxLength) {
    if (!text) return '';
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength) + '...';
}

// ============================================
// Start
// ============================================
document.addEventListener('DOMContentLoaded', init);
