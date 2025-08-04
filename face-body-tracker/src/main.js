const videoElement = document.getElementById('webcam');
const canvasElement = document.getElementById('output');
const canvasCtx = canvasElement.getContext('2d');
const auraCanvas = document.getElementById('webglAura');
auraCanvas.width = 640;
auraCanvas.height = 480;
const gl = auraCanvas.getContext('webgl', { alpha: true });
gl.clearColor(0.2, 0.0, 0.2, 1.0); // dark pink background

const audioContext = new AudioContext();
const analyser = audioContext.createAnalyser();
analyser.fftSize = 256;
const dataArray = new Uint8Array(analyser.frequencyBinCount);
let audioLevel = 0;

navigator.mediaDevices.getUserMedia({ audio: true }).then((stream) => {
  const micSource = audioContext.createMediaStreamSource(stream);
  micSource.connect(analyser);
});


// Request microphone access
navigator.mediaDevices.getUserMedia({ audio: true }).then((stream) => {
  const micSource = audioContext.createMediaStreamSource(stream);
  micSource.connect(analyser);
});

// === SHADERS ===
const vertShaderSrc = `
  attribute vec2 a_position;
  varying vec2 vUv;
  void main() {
    vUv = a_position * 0.5 + 0.5;
    gl_Position = vec4(a_position, 0, 1);
  }
`;

const fragShaderSrc = `
  precision mediump float;
  varying vec2 vUv;
  uniform sampler2D u_video;
  uniform sampler2D u_mask;
  uniform float u_time;
  uniform float u_audioLevel;

  float blur(vec2 uv, float radius) {
    float sum = 0.0;
    for (int x = -2; x <= 2; x++) {
      for (int y = -2; y <= 2; y++) {
        vec2 offset = vec2(float(x), float(y)) * radius / 640.0;
        sum += texture2D(u_mask, uv + offset).r;
      }
    }
    return sum / 25.0;
  }

  void main() {
    vec2 uv = vUv;
    float rawMask = texture2D(u_mask, uv).r;
    float mask = blur(uv, 2.5);

    if (mask < 0.05) {
      // Use u_audioLevel to modulate background color (pink to purple to white)
      vec3 bgColor = vec3(0.5 + u_audioLevel * 0.5, 0.0, 0.5 + u_audioLevel * 0.5);
      gl_FragColor = vec4(bgColor, 1.0);
      return;
    }

    float softEdge = smoothstep(0.1, 0.5, mask);
    float auraGlow = smoothstep(0.1, 0.9, mask);
    float halo = smoothstep(0.0, 0.1, mask);

    vec3 aura = mix(vec3(0.1, 0.8, 1.0), vec3(1.0, 0.1, 0.6), auraGlow);
    vec3 glow = aura * auraGlow + vec3(1.0, 0.5, 1.0) * halo * 0.5;

    vec3 noisyPink = vec3(1.0, 0.1 + u_audioLevel * 0.5, 0.6 + u_audioLevel * 0.4);
    noisyPink = clamp(noisyPink, 0.0, 1.0);

    vec3 result = mix(glow, noisyPink, 0.8);
    gl_FragColor = vec4(result, softEdge);
  }
`;


function compileShader(src, type) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, src);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw gl.getShaderInfoLog(shader);
  return shader;
}

const program = gl.createProgram();
gl.attachShader(program, compileShader(vertShaderSrc, gl.VERTEX_SHADER));
gl.attachShader(program, compileShader(fragShaderSrc, gl.FRAGMENT_SHADER));
gl.linkProgram(program);
gl.useProgram(program);

const positionLocation = gl.getAttribLocation(program, 'a_position');
const buffer = gl.createBuffer();
gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
  -1, -1, 1, -1, -1, 1,
  -1, 1, 1, -1, 1, 1,
]), gl.STATIC_DRAW);
gl.enableVertexAttribArray(positionLocation);
gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);

// === TEXTURES ===
function createTexture(index) {
  const tex = gl.createTexture();
  gl.activeTexture(gl.TEXTURE0 + index);
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return tex;
}

const videoTex = createTexture(0);
const maskTex = createTexture(1);
gl.uniform1i(gl.getUniformLocation(program, 'u_video'), 0);
gl.uniform1i(gl.getUniformLocation(program, 'u_mask'), 1);
const timeUniform = gl.getUniformLocation(program, 'u_time');
const audioUniform = gl.getUniformLocation(program, 'u_audioLevel');

function render(video, mask, time) {
  analyser.getByteFrequencyData(dataArray);
  let sum = 0;
  for (let i = 0; i < dataArray.length; i++) {
    sum += dataArray[i];
  }
  audioLevel = (sum / dataArray.length / 255) * 3.0;
  audioLevel = Math.min(audioLevel, 1.0);
  gl.clear(gl.COLOR_BUFFER_BIT);

  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, videoTex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, video);

  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_2D, maskTex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, gl.LUMINANCE, gl.UNSIGNED_BYTE, mask);

  gl.uniform1f(timeUniform, time * 0.001);
  gl.uniform1f(audioUniform, audioLevel);
  gl.drawArrays(gl.TRIANGLES, 0, 6);
}

// === MEDIAPIPE SETUP ===
const holistic = new Holistic({
  locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/holistic/${file}`
});

holistic.setOptions({
  modelComplexity: 1,
  smoothLandmarks: true,
  enableSegmentation: true,
  refineFaceLandmarks: true,
  minDetectionConfidence: 0.5,
  minTrackingConfidence: 0.5
});

let lastMask = document.createElement('canvas');
lastMask.width = 640;
lastMask.height = 480;
let lastCtx = lastMask.getContext('2d');

holistic.onResults((results) => {
  if (results.segmentationMask) {
    lastCtx.clearRect(0, 0, 640, 480);
    lastCtx.drawImage(results.segmentationMask, 0, 0, 640, 480);
    render(videoElement, lastMask, performance.now());
  }

  canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);
  // const pinkG = Math.floor(60 + audioLevel * 180);  // green: 60 → 240
  // const pinkB = Math.floor(130 + audioLevel * 100); // blue: 130 → 230
  // const skeletonColor = `rgb(255, ${pinkG}, ${pinkB})`;
  // canvasCtx.shadowColor = '#FF33CC'; // glowing pink
  // canvasCtx.shadowBlur = 20;
  const r = 255;
  const g = Math.floor((0.1 + audioLevel * 0.5) * 255 * 0.99); // slightly darker
  const b = Math.floor((0.6 + audioLevel * 0.4) * 255 * 0.99); // slightly darker
  const skeletonColor = `rgb(${r}, ${g}, ${b})`;

  canvasCtx.shadowColor = skeletonColor;
  canvasCtx.strokeStyle = skeletonColor;
  canvasCtx.fillStyle = skeletonColor;
  canvasCtx.shadowBlur = 20;


  if (results.poseLandmarks && results.faceLandmarks) {
    const pose = results.poseLandmarks;
    const face = results.faceLandmarks;

    const leftShoulder = pose[11];
    const rightShoulder = pose[12];
    const leftHip = pose[23];
    const rightHip = pose[24];
    const nose = face[1];

    const centerX = nose.x * canvasElement.width;
    const centerY = nose.y * canvasElement.height;

    // Midpoints
    const shoulderX = ((leftShoulder.x + rightShoulder.x) / 2) * canvasElement.width;
    const shoulderY = ((leftShoulder.y + rightShoulder.y) / 2) * canvasElement.height;
    const hipX = ((leftHip.x + rightHip.x) / 2) * canvasElement.width;
    const hipY = ((leftHip.y + rightHip.y) / 2) * canvasElement.height;

    // === Spine: shoulder midpoint → hip midpoint ===
    canvasCtx.beginPath();
    canvasCtx.moveTo(shoulderX, shoulderY);
    canvasCtx.lineTo(hipX, hipY);
    canvasCtx.strokeStyle = skeletonColor;
    canvasCtx.lineWidth = 6;
    canvasCtx.shadowColor = skeletonColor; // lighter glow
    canvasCtx.shadowBlur = 20;
    canvasCtx.stroke();

    // === Neck ===
    canvasCtx.beginPath();
    canvasCtx.moveTo(shoulderX, shoulderY);
    canvasCtx.lineTo(centerX, centerY + 10);
    canvasCtx.strokeStyle = skeletonColor;
    canvasCtx.lineWidth = 6;
    canvasCtx.shadowColor = skeletonColor;
    canvasCtx.shadowBlur = 20;
    canvasCtx.stroke();

    // === Head Circle ===
    canvasCtx.beginPath();
    canvasCtx.arc(centerX, centerY, 35, 0, Math.PI * 2);
    canvasCtx.fillStyle = skeletonColor;
    canvasCtx.shadowColor = skeletonColor;
    canvasCtx.shadowBlur = 20;
    canvasCtx.fill();

    canvasCtx.shadowBlur = 0;
  }


  if (results.poseLandmarks) {
    drawConnectors(canvasCtx, results.poseLandmarks, POSE_CONNECTIONS, { color: skeletonColor, lineWidth: 8 });
    drawLandmarks(canvasCtx, results.poseLandmarks, { color: skeletonColor, lineWidth: 4 });
  }
  if (results.faceLandmarks) {
    drawConnectors(canvasCtx, results.faceLandmarks, FACEMESH_TESSELATION, { color: skeletonColor, lineWidth: 2 });
  }
  if (results.leftHandLandmarks) {
    drawConnectors(canvasCtx, results.leftHandLandmarks, HAND_CONNECTIONS, { color: skeletonColor, lineWidth: 6 });
    drawLandmarks(canvasCtx, results.leftHandLandmarks, { color: skeletonColor, lineWidth: 4 });
  }
  if (results.rightHandLandmarks) {
    drawConnectors(canvasCtx, results.rightHandLandmarks, HAND_CONNECTIONS, { color: skeletonColor, lineWidth: 6 });
    drawLandmarks(canvasCtx, results.rightHandLandmarks, { color: skeletonColor, lineWidth: 4 });
  }
  canvasCtx.shadowBlur = 0;
});

const camera = new Camera(videoElement, {
  onFrame: async () => {
    await holistic.send({ image: videoElement });
  },
  width: 640,
  height: 480
});
camera.start();