const videoElement = document.getElementById('webcam');
const canvasElement = document.getElementById('output');
const canvasCtx = canvasElement.getContext('2d');
const auraCanvas = document.getElementById('webglAura');
auraCanvas.width = 640;
auraCanvas.height = 480;
const gl = auraCanvas.getContext('webgl', { alpha: true });

const audioContext = new AudioContext();
const analyser = audioContext.createAnalyser();
analyser.fftSize = 256;
const dataArray = new Uint8Array(analyser.frequencyBinCount);
let audioLevel = 0;

navigator.mediaDevices.getUserMedia({ audio: true }).then((stream) => {
  const micSource = audioContext.createMediaStreamSource(stream);
  micSource.connect(analyser);
});

// === COLORS ===
function hexToRGBVec3(hex) {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  return [r, g, b];
}

function lerpColor(c1, c2, t) {
  return c1.map((v, i) => v + (c2[i] - v) * t);
}

const baseColorInput = document.getElementById('baseColor');
const loudBodyColorInput = document.getElementById('loudBodyColor');
const quietBGColorInput = document.getElementById('quietBackgroundColor');
const loudBGColorInput = document.getElementById('loudBackgroundColor');

let baseColorVec3 = hexToRGBVec3(baseColorInput.value);
let loudBodyColorVec3 = hexToRGBVec3(loudBodyColorInput.value);
let quietBGColorVec3 = hexToRGBVec3(quietBGColorInput.value);
let loudBGColorVec3 = hexToRGBVec3(loudBGColorInput.value);

baseColorInput.addEventListener('input', () => {
  baseColorVec3 = hexToRGBVec3(baseColorInput.value);
});
loudBodyColorInput.addEventListener('input', () => {
  loudBodyColorVec3 = hexToRGBVec3(loudBodyColorInput.value);
});
quietBGColorInput.addEventListener('input', () => {
  quietBGColorVec3 = hexToRGBVec3(quietBGColorInput.value);
});
loudBGColorInput.addEventListener('input', () => {
  loudBGColorVec3 = hexToRGBVec3(loudBGColorInput.value);
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
  uniform vec3 u_baseColor;
  uniform vec3 u_loudColor;
  uniform vec3 u_quietBGColor;
  uniform vec3 u_loudBGColor;

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
      vec3 bgColor = mix(u_quietBGColor, u_loudBGColor, u_audioLevel);
      gl_FragColor = vec4(bgColor, 1.0);
      return;
    }

    float softEdge = smoothstep(0.1, 0.5, mask);
    float auraGlow = smoothstep(0.1, 0.9, mask);
    float halo = smoothstep(0.0, 0.1, mask);

    vec3 aura = mix(vec3(0.1, 0.8, 1.0), vec3(1.0, 0.1, 0.6), auraGlow);
    vec3 glow = aura * auraGlow + vec3(1.0, 0.5, 1.0) * halo * 0.5;

    vec3 bodyColor = mix(u_baseColor, u_loudColor, u_audioLevel);
    vec3 result = mix(glow, bodyColor, 0.8);

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

// === UNIFORMS ===
const baseColorUniform = gl.getUniformLocation(program, 'u_baseColor');
const loudColorUniform = gl.getUniformLocation(program, 'u_loudColor');
const quietBGUniform = gl.getUniformLocation(program, 'u_quietBGColor');
const loudBGUniform = gl.getUniformLocation(program, 'u_loudBGColor');
const timeUniform = gl.getUniformLocation(program, 'u_time');
const audioUniform = gl.getUniformLocation(program, 'u_audioLevel');

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

function render(video, mask, time) {
  analyser.getByteFrequencyData(dataArray);
  let sum = 0;
  for (let i = 0; i < dataArray.length; i++) sum += dataArray[i];
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

  const bodyColor = lerpColor(baseColorVec3, loudBodyColorVec3, audioLevel);
  const bgColor = lerpColor(quietBGColorVec3, loudBGColorVec3, audioLevel);

  gl.uniform3fv(baseColorUniform, bodyColor);
  gl.uniform3fv(loudColorUniform, loudBodyColorVec3);
  gl.uniform3fv(quietBGUniform, quietBGColorVec3);
  gl.uniform3fv(loudBGUniform, loudBGColorVec3);

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
  refineFaceLandmarks: false,
  minDetectionConfidence: 0.5,
  minTrackingConfidence: 0.5,
  faceLandmarks: false,
  refineFaceLandmarks: false,
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
  const skeletonColorVec3 = lerpColor(baseColorVec3, loudBodyColorVec3, audioLevel);
  const [r, g, b] = skeletonColorVec3.map(c => Math.floor(c * 255));
  const skeletonColor = `rgba(${r}, ${g}, ${b}, 0.55)`;

  canvasCtx.shadowColor = skeletonColor;
  canvasCtx.strokeStyle = skeletonColor;
  canvasCtx.fillStyle = skeletonColor;
  canvasCtx.shadowBlur = 20;


  if (results.poseLandmarks) {
    const pose = results.poseLandmarks;

    const leftShoulder = pose[11];
    const rightShoulder = pose[12];
    const leftHip = pose[23];
    const rightHip = pose[24];
    const nose = pose[0]; // or use leftEyeInner/outer as fallback for top of neck

    const centerX = nose.x * canvasElement.width;
    const centerY = nose.y * canvasElement.height;

    const shoulderX = ((leftShoulder.x + rightShoulder.x) / 2) * canvasElement.width;
    const shoulderY = ((leftShoulder.y + rightShoulder.y) / 2) * canvasElement.height;
    const hipX = ((leftHip.x + rightHip.x) / 2) * canvasElement.width;
    const hipY = ((leftHip.y + rightHip.y) / 2) * canvasElement.height;

    // === Spine: shoulder → hip ===
    canvasCtx.beginPath();
    canvasCtx.moveTo(shoulderX, shoulderY);
    canvasCtx.lineTo(hipX, hipY);
    canvasCtx.lineWidth = 8;
    canvasCtx.stroke();

    // === Neck: shoulder → head (estimated from nose or keypoint 0)

    // === Head Circle
    const leftEye = pose[2];
    const rightEye = pose[5];

    // Convert normalized coordinates to canvas space
    const lx = leftEye.x * canvasElement.width;
    const ly = leftEye.y * canvasElement.height;
    const rx = rightEye.x * canvasElement.width;
    const ry = rightEye.y * canvasElement.height;

    // Calculate distance between eyes
    const eyeDist = Math.hypot(rx - lx, ry - ly);

    // Use half the eye distance as radius (or adjust as needed)
    const headRadius = eyeDist * 0.75;  // tweak multiplier for best fit

    // Draw the head circle with dynamic radius
    canvasCtx.beginPath();
    canvasCtx.arc(centerX, centerY, headRadius, 0, Math.PI * 2);
    canvasCtx.lineWidth = 8;
    canvasCtx.fill();

    canvasCtx.beginPath();
    canvasCtx.moveTo(shoulderX, shoulderY);
    canvasCtx.lineTo(centerX, centerY + headRadius); // adjust if needed
    canvasCtx.lineWidth = 8;
    canvasCtx.stroke();
  }
  const SHOULDER_ARM_CONNECTIONS = [
    [11, 13], // left shoulder to left elbow
    [13, 15], // left elbow to left wrist
    [12, 14], // right shoulder to right elbow
    [14, 16], // right elbow to right wrist
    [11, 12], // left shoulder to right shoulder
  ];

  if (results.poseLandmarks) {
    drawConnectors(canvasCtx, results.poseLandmarks, SHOULDER_ARM_CONNECTIONS, {
      color: skeletonColor,
      lineWidth: 8
    });

    // Optional: draw landmarks only for shoulders and arms
    const armIndices = [11, 12, 13, 14, 15, 16];
    const armLandmarks = armIndices.map(i => results.poseLandmarks[i]);

    drawLandmarks(canvasCtx, armLandmarks, {
      color: skeletonColor,
      lineWidth: 4
    });
  }
  // if (results.faceLandmarks) {
  //   drawConnectors(canvasCtx, results.faceLandmarks, FACEMESH_TESSELATION, { color: skeletonColor, lineWidth: 2 });
  // }
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

colorInput.addEventListener('input', () => {
  baseColorVec3 = hexToRGBVec3(colorInput.value);
});