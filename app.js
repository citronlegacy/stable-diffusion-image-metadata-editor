// Core logic for Stable Diffusion Prompt Reader
// Handles image upload, metadata extraction, prompt display/management

const dropArea = document.getElementById('drop-area');
const fileInput = document.getElementById('fileInput');
const statusBar = document.getElementById('status-bar');
const promptSection = document.getElementById('prompt-section');
const promptDisplay = document.getElementById('prompt-display');
const paramList = document.getElementById('param-list');
const promptTabs = document.getElementById('prompt-tabs');

// Drag & drop
['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
  dropArea.addEventListener(eventName, e => {
    e.preventDefault();
    e.stopPropagation();
    dropArea.classList.toggle('active', eventName === 'dragover');
  });
});
dropArea.addEventListener('drop', e => {
  const files = e.dataTransfer.files;
  handleFiles(files);
});
dropArea.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', e => {
  handleFiles(e.target.files);
});


function handleFiles(files) {
  if (!files.length) return;
  const file = files[0];
  statusBar.textContent = `Loading ${file.name}...`;
  // Show image preview
  const preview = document.getElementById('image-preview');
  preview.innerHTML = '';
  const img = document.createElement('img');
  img.src = URL.createObjectURL(file);
  img.alt = file.name;
  preview.appendChild(img);
  readImageMetadata(file);
}



function readImageMetadata(file) {
  // Only PNG for now; JPEG/WEBP can be added later
  const reader = new FileReader();
  reader.onload = function(e) {
    const arr = new Uint8Array(e.target.result);
    let text = '';
    // PNG text chunk extraction
    if (file.type === 'image/png') {
      let i = 8; // skip PNG header
      while (i < arr.length) {
        let length = (arr[i]<<24) | (arr[i+1]<<16) | (arr[i+2]<<8) | arr[i+3];
        let type = String.fromCharCode(arr[i+4],arr[i+5],arr[i+6],arr[i+7]);
        if (type === 'tEXt' || type === 'iTXt') {
          let chunk = arr.slice(i+8, i+8+length);
          let chunkText = new TextDecoder().decode(chunk);
          if (chunkText.match(/Steps:|Negative prompt:/)) {
            text = chunkText;
            break;
          }
        }
        i += 8 + length + 4;
      }
    }
    // Fallback: try EXIF for JPEG/WEBP (not implemented yet)
    if (!text) text = 'Prompt not found.';
    // Parse prompt metadata
    const parsed = parsePrompt(text);
    showPrompt(parsed);
  };
  reader.readAsArrayBuffer(file);
}



// Parse prompt metadata into positive, negative, and other metadata
function parsePrompt(raw) {
  // Remove any leading "parameters" line
  raw = raw.replace(/^parameters\s*/i, '');

  // Find boundaries
  const negIdx = raw.search(/\n?Negative prompt:/i);
  const stepsIdx = raw.search(/\n?Steps:/i);

  // 1. Positive prompt: all text up to "Negative prompt"
  let positive = negIdx !== -1 ? raw.slice(0, negIdx).replace(/^Prompt:/i, '').trim() : raw.trim();

  // 2. Negative prompt: from "Negative prompt" up to "Steps"
  let negative = '';
  if (negIdx !== -1 && stepsIdx !== -1 && stepsIdx > negIdx) {
    negative = raw.slice(negIdx, stepsIdx).replace(/\n?Negative prompt:/i, '').trim();
  } else if (negIdx !== -1) {
    negative = raw.slice(negIdx).replace(/\n?Negative prompt:/i, '').trim();
  }

  // 3. Other metadata: from "Steps" to end
  let setting = '';
  if (stepsIdx !== -1) {
    setting = raw.slice(stepsIdx).trim();
  }
  let params = {};
  let paramLines = setting.split('\n');
  paramLines.forEach(line => {
    let m = line.match(/^([\w ][\w ]*):\s*(.+)$/);
    if (m) {
      params[m[1]] = m[2];
    }
  });

  // Return the split metadata
  return { prompt: positive, negative, params, tool: 'AUTOMATIC1111', sdxl: false };
}




function showPrompt(data) {
  promptSection.style.display = '';
  // Fill textareas
  document.getElementById('positive-prompt').value = data.prompt || '';
  document.getElementById('negative-prompt').value = data.negative || '';
  // Metadata as editable text (key: value per line)
  let metaText = Object.keys(data.params).sort().map(key => `${key}: ${data.params[key]}`).join('\n');
  document.getElementById('param-list').value = metaText;
  // Remove detected tool status
  statusBar.textContent = '';
}


// Copy Positive Prompt
document.getElementById('copyBtn').onclick = function() {
  const text = document.getElementById('positive-prompt').value;
  navigator.clipboard.writeText(text);
};

// Save Edits: update image metadata and download
document.getElementById('saveBtn').onclick = function() {
  const img = document.querySelector('#image-preview img');
  if (!img) return;
  // Get edited values
  const positive = document.getElementById('positive-prompt').value;
  const negative = document.getElementById('negative-prompt').value;
  const metaText = document.getElementById('param-list').value;
  // Reconstruct A1111 metadata
  let metadata = positive;
  if (negative) metadata += `\nNegative prompt: ${negative}`;
  if (metaText) metadata += `\n${metaText}`;
  // Download image with new metadata (PNG only)
  fetch(img.src)
    .then(res => res.blob())
    .then(blob => {
      const reader = new FileReader();
      reader.onload = function(e) {
        const arr = new Uint8Array(e.target.result);
        // Insert tEXt chunk with new metadata
        const png = updatePngTextChunk(arr, metadata);
        // Download
        const a = document.createElement('a');
        let origName = img.alt || 'image.png';
        let ext = origName.lastIndexOf('.') !== -1 ? origName.slice(origName.lastIndexOf('.')) : '.png';
        let base = origName.lastIndexOf('.') !== -1 ? origName.slice(0, origName.lastIndexOf('.')) : origName;
        a.download = base + '_edit' + ext;
        a.href = URL.createObjectURL(new Blob([png], {type: 'image/png'}));
        a.click();
      };
      reader.readAsArrayBuffer(blob);
    });
};

// Helper: update PNG tEXt chunk (simple replace or add)
function updatePngTextChunk(arr, text) {
  // This is a minimal implementation: removes all tEXt/iTXt chunks and adds one with new text
  let out = [];
  // PNG header
  for (let i = 0; i < 8; i++) out.push(arr[i]);
  let i = 8;
  let inserted = false;
  while (i < arr.length) {
    let length = (arr[i]<<24) | (arr[i+1]<<16) | (arr[i+2]<<8) | arr[i+3];
    let type = String.fromCharCode(arr[i+4],arr[i+5],arr[i+6],arr[i+7]);
    if (type === 'tEXt' || type === 'iTXt') {
      // skip old text chunk
      i += 8 + length + 4;
      continue;
    }
    // Before IEND, insert new tEXt chunk
    if (!inserted && type === 'IEND') {
      // tEXt chunk
      let t = new TextEncoder().encode(text);
      let len = t.length;
      out.push((len>>>24)&0xff, (len>>>16)&0xff, (len>>>8)&0xff, len&0xff);
      out.push(...[...'tEXt'].map(c=>c.charCodeAt(0)));
      out.push(...t);
      // CRC
      let crc = crc32(new Uint8Array([...'tEXt'].map(c=>c.charCodeAt(0)), ...t));
      out.push((crc>>>24)&0xff, (crc>>>16)&0xff, (crc>>>8)&0xff, crc&0xff);
      inserted = true;
    }
    // Copy chunk
    let chunkLen = 8 + length + 4;
    for (let j = 0; j < chunkLen; j++) out.push(arr[i+j]);
    i += chunkLen;
  }
  return new Uint8Array(out);
}

// CRC32 helper for PNG chunk
function crc32(buf) {
  let table = window._crcTable;
  if (!table) {
    table = window._crcTable = [];
    for (let n =0; n < 256; n++) {
      let c = n;
      for (let k=0; k<8; k++) c = ((c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1));
      table[n] = c;
    }
  }
  let crc = -1;
  for (let i=0; i<buf.length; i++) crc = (crc >>> 8) ^ table[(crc ^ buf[i]) & 0xff];
  return (crc ^ -1) >>> 0;
}
