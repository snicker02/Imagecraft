// nbt.js — little-endian NBT, the flavour Bedrock uses for .mcstructure files.
//
// Values are tagged plain objects:
//   { t:'int', v:5 }  { t:'string', v:'hi' }  { t:'compound', v:{ key:value } }
//   { t:'list', et:'int', v:[...] }           { t:'byte', v:1 }
// Helpers below keep call sites readable.

export const TAG = {
  end: 0, byte: 1, short: 2, int: 3, long: 4, float: 5, double: 6,
  byteArray: 7, string: 8, list: 9, compound: 10, intArray: 11, longArray: 12,
};
const NAME_OF = Object.fromEntries(Object.entries(TAG).map(([k, v]) => [v, k]));

export const nbt = {
  byte: v => ({ t: 'byte', v }),
  short: v => ({ t: 'short', v }),
  int: v => ({ t: 'int', v }),
  long: v => ({ t: 'long', v: BigInt(v) }),
  float: v => ({ t: 'float', v }),
  double: v => ({ t: 'double', v }),
  string: v => ({ t: 'string', v }),
  compound: v => ({ t: 'compound', v }),
  list: (et, v) => ({ t: 'list', et, v }),
  intArray: v => ({ t: 'intArray', v }),
  byteArray: v => ({ t: 'byteArray', v }),
};

class Writer {
  constructor() { this.buf = new Uint8Array(1 << 16); this.view = new DataView(this.buf.buffer); this.p = 0; }
  need(n) {
    if (this.p + n <= this.buf.length) return;
    let cap = this.buf.length;
    while (cap < this.p + n) cap *= 2;
    const nb = new Uint8Array(cap);
    nb.set(this.buf.subarray(0, this.p));
    this.buf = nb; this.view = new DataView(nb.buffer);
  }
  u8(v) { this.need(1); this.view.setUint8(this.p, v); this.p += 1; }
  i8(v) { this.need(1); this.view.setInt8(this.p, v); this.p += 1; }
  i16(v) { this.need(2); this.view.setInt16(this.p, v, true); this.p += 2; }
  u16(v) { this.need(2); this.view.setUint16(this.p, v, true); this.p += 2; }
  i32(v) { this.need(4); this.view.setInt32(this.p, v, true); this.p += 4; }
  i64(v) { this.need(8); this.view.setBigInt64(this.p, BigInt(v), true); this.p += 8; }
  f32(v) { this.need(4); this.view.setFloat32(this.p, v, true); this.p += 4; }
  f64(v) { this.need(8); this.view.setFloat64(this.p, v, true); this.p += 8; }
  str(s) {
    const b = new TextEncoder().encode(s);
    this.u16(b.length); this.need(b.length); this.buf.set(b, this.p); this.p += b.length;
  }
  done() { return this.buf.slice(0, this.p); }
}

function writePayload(w, val) {
  switch (val.t) {
    case 'byte': w.i8(val.v); break;
    case 'short': w.i16(val.v); break;
    case 'int': w.i32(val.v); break;
    case 'long': w.i64(val.v); break;
    case 'float': w.f32(val.v); break;
    case 'double': w.f64(val.v); break;
    case 'string': w.str(val.v); break;
    case 'byteArray': w.i32(val.v.length); for (const b of val.v) w.i8(b); break;
    case 'intArray': w.i32(val.v.length); for (const b of val.v) w.i32(b); break;
    case 'list': {
      const items = val.v;
      const etId = TAG[val.et];
      w.u8(etId === undefined ? TAG.end : etId);
      w.i32(items.length);
      for (const it of items) writePayload(w, it);
      break;
    }
    case 'compound': {
      for (const [k, v] of Object.entries(val.v)) {
        if (v === undefined || v === null) continue;
        w.u8(TAG[v.t]); w.str(k); writePayload(w, v);
      }
      w.u8(TAG.end);
      break;
    }
    default: throw new Error('unknown NBT tag: ' + val.t);
  }
}

/** Serialise a root compound. Returns Uint8Array. */
export function write(root, rootName = '') {
  if (root.t !== 'compound') throw new Error('NBT root must be a compound');
  const w = new Writer();
  w.u8(TAG.compound); w.str(rootName); writePayload(w, root);
  return w.done();
}

// --- reader (used by the validation harness and by "verify export") ---------

class Reader {
  constructor(buf) { this.buf = buf; this.view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength); this.p = 0; }
  u8() { return this.view.getUint8(this.p++); }
  i8() { const v = this.view.getInt8(this.p); this.p += 1; return v; }
  i16() { const v = this.view.getInt16(this.p, true); this.p += 2; return v; }
  u16() { const v = this.view.getUint16(this.p, true); this.p += 2; return v; }
  i32() { const v = this.view.getInt32(this.p, true); this.p += 4; return v; }
  i64() { const v = this.view.getBigInt64(this.p, true); this.p += 8; return v; }
  f32() { const v = this.view.getFloat32(this.p, true); this.p += 4; return v; }
  f64() { const v = this.view.getFloat64(this.p, true); this.p += 8; return v; }
  str() {
    const n = this.u16();
    const s = new TextDecoder().decode(this.buf.subarray(this.p, this.p + n));
    this.p += n; return s;
  }
}

function readPayload(r, type) {
  switch (type) {
    case TAG.byte: return { t: 'byte', v: r.i8() };
    case TAG.short: return { t: 'short', v: r.i16() };
    case TAG.int: return { t: 'int', v: r.i32() };
    case TAG.long: return { t: 'long', v: r.i64() };
    case TAG.float: return { t: 'float', v: r.f32() };
    case TAG.double: return { t: 'double', v: r.f64() };
    case TAG.string: return { t: 'string', v: r.str() };
    case TAG.byteArray: { const n = r.i32(), a = []; for (let i = 0; i < n; i++) a.push(r.i8()); return { t: 'byteArray', v: a }; }
    case TAG.intArray: { const n = r.i32(), a = []; for (let i = 0; i < n; i++) a.push(r.i32()); return { t: 'intArray', v: a }; }
    case TAG.list: {
      const et = r.u8(), n = r.i32(), a = [];
      for (let i = 0; i < n; i++) a.push(readPayload(r, et));
      return { t: 'list', et: NAME_OF[et], v: a };
    }
    case TAG.compound: {
      const obj = {};
      for (;;) {
        const t = r.u8();
        if (t === TAG.end) break;
        const name = r.str();
        obj[name] = readPayload(r, t);
      }
      return { t: 'compound', v: obj };
    }
    default: throw new Error('unknown NBT tag id: ' + type);
  }
}

export function read(bytes) {
  const r = new Reader(bytes);
  const t = r.u8();
  if (t !== TAG.compound) throw new Error('not an NBT compound root');
  const name = r.str();
  return { name, root: readPayload(r, TAG.compound) };
}
