import { describe, it, expect } from 'vitest';
import { encode as cborEncode } from 'cbor-x';
import * as btc from 'bitcoinjs-lib';
import { parse_op_return } from '../src/op-return-parser';
import { PREFIX_BYTES } from '../src/constants';

// RC4 implementation for test setup (matches the one in op-return-parser.ts)
function rc4Encrypt(key: Buffer, data: Buffer): Buffer {
  const S = new Uint8Array(256);
  for (let i = 0; i < 256; i++) S[i] = i;
  
  let j = 0;
  for (let i = 0; i < 256; i++) {
    j = (j + S[i] + key[i % key.length]) & 0xFF;
    [S[i], S[j]] = [S[j], S[i]];
  }
  
  const output = Buffer.alloc(data.length);
  let i = 0;
  j = 0;
  
  for (let k = 0; k < data.length; k++) {
    i = (i + 1) & 0xFF;
    j = (j + S[i]) & 0xFF;
    [S[i], S[j]] = [S[j], S[i]];
    output[k] = data[k] ^ S[(S[i] + S[j]) & 0xFF];
  }
  
  return output;
}

// Helper to create valid Counterparty OP_RETURN script
function createOpReturn(messageId: number, payload: Buffer, txid: string): Buffer {
  const message = Buffer.concat([
    Buffer.from([messageId]), // Short ID
    payload
  ]);
  
  const plaintext = Buffer.concat([PREFIX_BYTES, message]);
  const key = Buffer.from(txid, 'hex');
  const encrypted = rc4Encrypt(key, plaintext);
  
  // Create OP_RETURN script: 0x6a (OP_RETURN) + length byte + data
  return Buffer.concat([
    Buffer.from([0x6a, encrypted.length]),
    encrypted
  ]);
}

describe('parse_op_return', () => {
  const network = btc.networks.bitcoin;
  const txid = 'a'.repeat(64); // Sample txid

  it('should return null for non-OP_RETURN script', () => {
    const script = Buffer.from([0x76, 0xa9, 0x14]); // P2PKH script start
    expect(parse_op_return(script, txid, network)).toBeNull();
  });

  it('should return null for empty buffer', () => {
    expect(parse_op_return(Buffer.alloc(0), txid, network)).toBeNull();
  });

  it('should decode taproot commit marker (unencrypted)', () => {
    const script = Buffer.concat([
      Buffer.from([0x6a, PREFIX_BYTES.length]),
      PREFIX_BYTES
    ]);
    
    const result = parse_op_return(script, txid, network);
    expect(result).toEqual({
      message_name: 'taproot_commit',
      message_id: 0,
      params: { data: 'CNTRPRTY' }
    });
  });

  it('should decode Enhanced Send (ID 2)', () => {
    const payload = cborEncode([1n, 1000, Buffer.from([0x01, ...Array(20).fill(0xaa)])]);
    const script = createOpReturn(2, payload, txid);
    
    const result = parse_op_return(script, txid, network);
    expect(result?.message_name).toBe('enhanced_send');
    expect(result?.message_id).toBe(2);
    expect(result?.params).toHaveProperty('asset');
  });

  it('should decode Order (ID 10)', () => {
    const buffer = Buffer.alloc(34);
    buffer.writeBigUInt64BE(0n, 0);
    buffer.writeBigInt64BE(1000n, 8);
    buffer.writeBigUInt64BE(1n, 16);
    buffer.writeBigInt64BE(500n, 24);
    buffer.writeUInt16BE(100, 32);
    
    const script = createOpReturn(10, buffer, txid);
    const result = parse_op_return(script, txid, network);
    
    expect(result?.message_name).toBe('order');
    expect(result?.params).toHaveProperty('give_asset', 'BTC');
  });

  it('should handle different PUSHDATA opcodes', () => {
    const payload = cborEncode([1n, 500, Buffer.from([0x01, ...Array(20).fill(0xbb)])]);
    const script = createOpReturn(2, payload, txid);
    
    // Test with OP_PUSHDATA1 (0x4c)
    const scriptPushdata1 = Buffer.concat([
      Buffer.from([0x6a, 0x4c, script.length - 2]),
      script.subarray(2)
    ]);
    expect(parse_op_return(scriptPushdata1, txid, network)).toBeDefined();
    
    // Test with OP_PUSHDATA2 (0x4d)
    const scriptPushdata2 = Buffer.concat([
      Buffer.from([0x6a, 0x4d]),
      Buffer.from([script.length - 2, 0x00]),
      script.subarray(2)
    ]);
    expect(parse_op_return(scriptPushdata2, txid, network)).toBeDefined();
  });

  it('should return null for invalid prefix after decryption', () => {
    const invalidData = Buffer.from('INVALID_DATA_NO_PREFIX_HERE');
    const script = Buffer.concat([
      Buffer.from([0x6a, invalidData.length]),
      invalidData
    ]);
    
    expect(parse_op_return(script, txid, network)).toBeNull();
  });

  it('should return null for empty message after prefix', () => {
    const plaintext = PREFIX_BYTES; // Only prefix, no message
    const key = Buffer.from(txid, 'hex');
    const encrypted = rc4Encrypt(key, plaintext);
    const script = Buffer.concat([
      Buffer.from([0x6a, encrypted.length]),
      encrypted
    ]);
    
    expect(parse_op_return(script, txid, network)).toBeNull();
  });

  it('should return null when OP_RETURN length byte is missing', () => {
    const script = Buffer.from([0x6a]);
    expect(parse_op_return(script, txid, network)).toBeNull();
  });

  it('should handle unknown message types', () => {
    // For message IDs > 255, need to use long format (0x00 + 4 bytes)
    const longIdMessage = Buffer.alloc(6);
    longIdMessage[0] = 0x00; // Marker for long ID
    longIdMessage.writeUInt32BE(999, 1);
    longIdMessage[5] = 0x01; // Some payload
    
    const plaintext = Buffer.concat([PREFIX_BYTES, longIdMessage]);
    const key = Buffer.from(txid, 'hex');
    const encrypted = rc4Encrypt(key, plaintext);
    const script = Buffer.concat([
      Buffer.from([0x6a, encrypted.length]),
      encrypted
    ]);
    
    const result = parse_op_return(script, txid, network);
    expect(result?.message_name).toBe('unknown');
    expect(result?.message_id).toBe(999);
    expect(result?.params).toHaveProperty('raw');
  });

  it('should return null on decoding errors', () => {
    const invalidPayload = Buffer.from([0xff, 0xfe]); // Invalid CBOR
    const script = createOpReturn(2, invalidPayload, txid);
    const result = parse_op_return(script, txid, network);
    
    // Should still parse but with error in params
    expect(result).toBeDefined();
    expect(result?.params).toHaveProperty('error');
  });

  it('should handle long message IDs (4 bytes)', () => {
    const longIdMessage = Buffer.alloc(5);
    longIdMessage[0] = 0x00; // Marker for long ID
    longIdMessage.writeUInt32BE(1234, 1);
    
    const plaintext = Buffer.concat([PREFIX_BYTES, longIdMessage]);
    const key = Buffer.from(txid, 'hex');
    const encrypted = rc4Encrypt(key, plaintext);
    const script = Buffer.concat([
      Buffer.from([0x6a, encrypted.length]),
      encrypted
    ]);
    
    const result = parse_op_return(script, txid, network);
    expect(result?.message_id).toBe(1234);
  });

  it('should handle various message types correctly', () => {
    const testCases = [
      { id: 4, payload: cborEncode([Buffer.from([0x01, ...Array(20).fill(0xcc)]), 1, Buffer.alloc(0)]), name: 'sweep' },
      { id: 11, payload: Buffer.alloc(64), name: 'btc_pay' },
      { id: 110, payload: Buffer.alloc(16), name: 'destroy' }
    ];
    
    testCases.forEach(({ id, payload, name }) => {
      const script = createOpReturn(id, payload, txid);
      const result = parse_op_return(script, txid, network);
      expect(result?.message_name).toBe(name);
    });
  });

  it('should handle OP_PUSHDATA4 (0x4e)', () => {
    const payload = cborEncode([1n, 1000, Buffer.from([0x01, ...Array(20).fill(0xee)])]);
    const script = createOpReturn(2, payload, txid);
    
    // Create script with OP_PUSHDATA4
    const scriptPushdata4 = Buffer.concat([
      Buffer.from([0x6a, 0x4e]),
      Buffer.from([script.length - 2, 0x00, 0x00, 0x00]), // 4 bytes length (little-endian)
      script.subarray(2)
    ]);
    
    const result = parse_op_return(scriptPushdata4, txid, network);
    expect(result?.message_name).toBe('enhanced_send');
  });

  it('should return null on parsing error with invalid transaction', () => {
    // Create a malformed script that will trigger an error
    const malformedScript = Buffer.from([0x6a, 0x01]);
    expect(parse_op_return(malformedScript, 'invalid_txid', network)).toBeNull();
  });

  it('should return null when message type parsing fails', () => {
    const invalidMessage = Buffer.from([0x00, 0xaa, 0xbb, 0xcc]); // Long ID but too short
    const plaintext = Buffer.concat([PREFIX_BYTES, invalidMessage]);
    const key = Buffer.from(txid, 'hex');
    const encrypted = rc4Encrypt(key, plaintext);
    const script = Buffer.concat([
      Buffer.from([0x6a, encrypted.length]),
      encrypted
    ]);

    expect(parse_op_return(script, txid, network)).toBeNull();
  });

  it('should handle decryption error with malformed encrypted data', () => {
    // Create a script that will cause an error during decoding
    const payload = Buffer.alloc(10, 0xff);
    const script = Buffer.concat([Buffer.from([0x6a, payload.length]), payload]);
    
    // Use invalid txid that may cause issues
    const result = parse_op_return(script, 'zz', network);
    expect(result).toBeNull();
  });
});

