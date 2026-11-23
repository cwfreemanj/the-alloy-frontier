// Minimal browser shims so three's FBXLoader / ColladaLoader / GLTFExporter run in Node.
import { DOMParser } from '@xmldom/xmldom';

globalThis.self = globalThis;
globalThis.window = globalThis;
globalThis.DOMParser = DOMParser;

// Embedded FBX textures: FBXLoader turns them into blob URLs. Capture the bytes instead.
export const blobStore = new Map();
let blobId = 0;
const realCreate = URL.createObjectURL;
URL.createObjectURL = (blob) => {
  const id = `blob:node/${++blobId}`;
  blobStore.set(id, blob);
  return id;
};
URL.revokeObjectURL = () => {};

globalThis.FileReader = class {
  constructor() {
    this.onload = null;
    this.onloadend = null;
    this.result = null;
  }
  async readAsArrayBuffer(blob) {
    this.result = await blob.arrayBuffer();
    this.onload?.({ target: this });
    this.onloadend?.({ target: this });
  }
  async readAsDataURL(blob) {
    const b = Buffer.from(await blob.arrayBuffer());
    this.result = `data:${blob.type || 'application/octet-stream'};base64,${b.toString('base64')}`;
    this.onload?.({ target: this });
    this.onloadend?.({ target: this });
  }
};
export { realCreate };
