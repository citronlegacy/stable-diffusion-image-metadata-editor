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
  console.log('Reading metadata for file:', file.name, 'type:', file.type);
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
    } else if (file.type === 'image/jpeg') {
      console.log('Processing JPEG file');
      // Try EXIF UserComment first
      text = extractEXIFUserComment(arr);
      if (!text) {
        // Fallback to simple text search
        let fullText = new TextDecoder().decode(arr);
        console.log('Full text length:', fullText.length);
        console.log('Full text length:', fullText);
        let match = fullText.match(/(Steps:.*)/s);
        console.log('Match found:', !!match);
        if (match) {
          text = match[1];
          console.log('Extracted text:', text.substring(0, 100) + '...');
        } else {
          console.log('No match for Steps:');
        }
      } else {
        console.log('Extracted from EXIF:', text.substring(0, 100) + '...');
      }
    }
    // Fallback
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
      let key = m[1];
      let value = m[2];
      // Try to parse JSON for fields like "Civitai resources" and "Civitai metadata"
      if (value.startsWith('[') || value.startsWith('{')) {
        try {
          params[key] = JSON.parse(value);
        } catch (e) {
          params[key] = value; // keep as string if not valid JSON
        }
      } else {
        params[key] = value;
      }
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
  let metaText = Object.keys(data.params).sort().map(key => {
    let value = data.params[key];
    if (typeof value === 'object') {
      value = JSON.stringify(value, null, 2);
    }
    return `${key}: ${value}`;
  }).join('\n');
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

// Helper to extract EXIF UserComment from JPEG
function extractEXIFUserComment(arr) {
  console.log('Attempting to extract EXIF UserComment');
  let i = 2; // after SOI
  while (i < arr.length - 1) {
    if (arr[i] === 0xFF && arr[i+1] === 0xE1) { // APP1
      let length = (arr[i+2] << 8) | arr[i+3];
      let marker = arr.slice(i+4, i+4+6);
      if (String.fromCharCode(...marker) === 'Exif\x00\x00') {
        console.log('Found EXIF APP1');
        let exifData = arr.slice(i+10, i+2+length);
        return parseTIFFForUserComment(exifData);
      }
      i += 2 + length;
    } else if (arr[i] === 0xFF && arr[i+1] >= 0xD0 && arr[i+1] <= 0xD9) { // RST or SOF
      i += 2;
    } else if (arr[i] === 0xFF) {
      let length = (arr[i+2] << 8) | arr[i+3];
      i += 2 + length;
    } else {
      i++;
    }
  }
  console.log('No EXIF found');
  return null;
}

function parseTIFFForUserComment(data) {
  console.log('TIFF data length:', data.length);
  if (data.length < 8) return null;
  let littleEndian = data[0] === 0x49 && data[1] === 0x49;
  let bigEndian = data[0] === 0x4D && data[1] === 0x4D;
  console.log('littleEndian:', littleEndian, 'bigEndian:', bigEndian);
  if (!littleEndian && !bigEndian) return null;
  let read16 = littleEndian ? (o) => data[o] | (data[o+1] << 8) : (o) => (data[o] << 8) | data[o+1];
  let read32 = littleEndian ? (o) => data[o] | (data[o+1] << 8) | (data[o+2] << 16) | (data[o+3] << 24) :
                              (o) => (data[o] << 24) | (data[o+1] << 16) | (data[o+2] << 8) | data[o+3];
  if (read16(2) !== 0x2A) return null;
  let ifdOffset = read32(4);
  console.log('ifdOffset:', ifdOffset);
  return parseIFD(data, ifdOffset, read16, read32, littleEndian);
}

function parseIFD(data, offset, read16, read32, littleEndian) {
  console.log('Parsing IFD at offset:', offset);
  let numEntries = read16(offset);
  console.log('numEntries:', numEntries);
  offset += 2;
  for (let j = 0; j < numEntries; j++) {
    let tag = read16(offset);
    let type = read16(offset+2);
    let count = read32(offset+4);
    let valueOffset = read32(offset+8);
    console.log('Entry', j, 'tag:', tag, 'type:', type, 'count:', count, 'valueOffset:', valueOffset);
    if (tag === 37510) { // UserComment
      console.log('Found UserComment tag');
      let comment;
      if (count <= 4) {
        comment = data.slice(offset+8, offset+8+count);
      } else {
        comment = data.slice(valueOffset, valueOffset + count);
      }
      // Remove encoding byte if present
      if (comment.length > 8 && comment[0] === 0x55 && comment[1] === 0x4E && comment[2] === 0x49 && comment[3] === 0x43 && comment[4] === 0x4F && comment[5] === 0x44 && comment[6] === 0x45 && comment[7] === 0x00) {
        comment = comment.slice(8);
        // UNICODE encoding in EXIF typically uses UTF-16BE regardless of TIFF endianness
        console.log('UNICODE encoding detected, using utf-16be decoder');
        return new TextDecoder('utf-16be').decode(comment).trim();
      }
      return new TextDecoder().decode(comment).trim();
    } else if (tag === 34665) { // ExifIFD
      console.log('Found ExifIFD tag, parsing subIFD at', valueOffset);
      let subResult = parseIFD(data, valueOffset, read16, read32, littleEndian);
      if (subResult) return subResult;
    }
    offset += 12;
  }
  let nextIFD = read32(offset);
  console.log('nextIFD:', nextIFD);
  if (nextIFD) return parseIFD(data, nextIFD, read16, read32, littleEndian);
  return null;
}
