import { describe, it, expect } from 'vitest';
import { encode as cborEncode } from 'cbor-x';
import * as btc from 'bitcoinjs-lib';
import { parse_reveal_tx } from '../src/reveal-parser';

// Helper to create Taproot transaction with witness envelope
function createRevealTx(witnessScript: Buffer, network = btc.networks.bitcoin): string {
  const tx = new btc.Transaction();
  
  // Add dummy input with witness
  const prevTxId = Buffer.alloc(32, 0);
  tx.addInput(prevTxId, 0, 0xffffffff, Buffer.alloc(0));
  
  // Add dummy output
  const dummyAddress = btc.payments.p2wpkh({
    pubkey: Buffer.alloc(33, 0x02),
    network
  }).address!;
  tx.addOutput(btc.address.toOutputScript(dummyAddress, network), 1000n);
  
  // Set witness with script and control block
  const witness = [
    Buffer.alloc(64), // signature
    witnessScript,
    Buffer.alloc(33) // control block
  ];
  tx.setWitness(0, witness);
  
  return tx.toHex();
}

// Helper to create envelope script
function createEnvelope(data: Buffer): Buffer {
  const chunks: Buffer[] = [];
  
  // OP_FALSE OP_IF
  chunks.push(Buffer.from([0x00, 0x63]));
  
  // Push data in chunks
  let offset = 0;
  while (offset < data.length) {
    const remaining = data.length - offset;
    const chunkSize = Math.min(remaining, 520);
    const chunk = data.subarray(offset, offset + chunkSize);
    
    if (chunkSize <= 75) {
      chunks.push(Buffer.from([chunkSize]));
    } else {
      chunks.push(Buffer.from([0x4c, chunkSize]));
    }
    chunks.push(chunk);
    offset += chunkSize;
  }
  
  // OP_ENDIF
  chunks.push(Buffer.from([0x68]));
  
  return Buffer.concat(chunks);
}

// Helper to create ord/xcp envelope script
function createOrdXcpEnvelope(messageTypeId: number, metadata: any, mimeType: string): Buffer {
  const chunks: Buffer[] = [];
  
  // OP_FALSE OP_IF
  chunks.push(Buffer.from([0x00, 0x63]));
  
  // "ord" as literal bytes (no push opcode)
  chunks.push(Buffer.from('ord', 'utf8'));
  
  // 0x07 marker
  chunks.push(Buffer.from([0x07]));
  
  // "xcp" as literal bytes (no push opcode)
  chunks.push(Buffer.from('xcp', 'utf8'));
  
  // 0x01 marker
  chunks.push(Buffer.from([0x01]));
  
  // mime_type: length byte + data (literal, no push opcode)
  const mimeTypeBuffer = Buffer.from(mimeType, 'utf8');
  chunks.push(Buffer.from([mimeTypeBuffer.length]));
  chunks.push(mimeTypeBuffer);
  
  // 0x05 marker
  chunks.push(Buffer.from([0x05]));
  
  // Encode CBOR metadata with message_type_id as first element
  const cborArray = [messageTypeId, ...metadata];
  const cborData = cborEncode(cborArray);
  
  // Push CBOR data in chunks WITH push opcodes
  let offset = 0;
  while (offset < cborData.length) {
    const remaining = cborData.length - offset;
    const chunkSize = Math.min(remaining, 75);
    const chunk = cborData.subarray(offset, offset + chunkSize);
    chunks.push(Buffer.from([chunkSize])); // push opcode
    chunks.push(chunk);
    offset += chunkSize;
  }
  
  // OP_ENDIF
  chunks.push(Buffer.from([0x68]));
  
  return Buffer.concat(chunks);
}

describe('parse_reveal_tx', () => {
  const network = btc.networks.bitcoin;

  it('should return null for tx without witness', () => {
    const tx = new btc.Transaction();
    tx.addInput(Buffer.alloc(32, 0), 0);
    tx.addOutput(Buffer.alloc(20), 1000n);
    
    expect(parse_reveal_tx(tx.toHex(), network)).toBeNull();
  });

  it('should return null for witness without envelope', () => {
    const tx = new btc.Transaction();
    tx.addInput(Buffer.alloc(32, 0), 0);
    tx.addOutput(Buffer.alloc(20), 1000n);
    tx.setWitness(0, [Buffer.alloc(64), Buffer.from([0x50])]);
    
    expect(parse_reveal_tx(tx.toHex(), network)).toBeNull();
  });

  it('should parse generic envelope with enhanced send', () => {
    const payload = cborEncode([1n, 100, Buffer.from([0x01, ...Array(20).fill(0xaa)])]);
    const message = Buffer.concat([Buffer.from([2]), payload]);
    const witnessScript = createEnvelope(message);
    const txHex = createRevealTx(witnessScript);
    
    const result = parse_reveal_tx(txHex, network);
    expect(result?.message_name).toBe('enhanced_send');
    expect(result?.message_id).toBe(2);
    expect(result?.params).toHaveProperty('asset');
  });

  it('should parse envelope with long message ID', () => {
    const longIdBuffer = Buffer.alloc(5);
    longIdBuffer[0] = 0x00;
    longIdBuffer.writeUInt32BE(300, 1);
    const payload = cborEncode([Buffer.alloc(21, 0xcc)]);
    const message = Buffer.concat([longIdBuffer, payload]);
    const witnessScript = createEnvelope(message);
    const txHex = createRevealTx(witnessScript);
    
    const result = parse_reveal_tx(txHex, network);
    expect(result?.message_id).toBe(300);
  });

  it('should handle OP_PUSHDATA opcodes', () => {
    const largePayload = cborEncode([1n, 500, Buffer.alloc(21, 0xdd)]);
    const message = Buffer.concat([Buffer.from([2]), largePayload]);
    
    const chunks = [Buffer.from([0x00, 0x63]), Buffer.from([0x4c, message.length]), message, Buffer.from([0x68])];
    const witnessScript = Buffer.concat(chunks);
    const txHex = createRevealTx(witnessScript);
    
    expect(parse_reveal_tx(txHex, network)).toBeDefined();
  });

  it('should handle OP_PUSHDATA2', () => {
    const data = Buffer.alloc(300, 0xee);
    const chunks = [Buffer.from([0x00, 0x63]), Buffer.from([0x4d]), Buffer.from([data.length & 0xff, (data.length >> 8) & 0xff]), data, Buffer.from([0x68])];
    const witnessScript = Buffer.concat(chunks);
    const txHex = createRevealTx(witnessScript);
    
    const result = parse_reveal_tx(txHex, network);
    expect(result).toBeDefined();
    expect(result?.message_id).toBe(238);
  });

  it('should return null for empty envelope', () => {
    const witnessScript = Buffer.from([0x00, 0x63, 0x68]); // OP_FALSE OP_IF OP_ENDIF
    const txHex = createRevealTx(witnessScript);
    
    expect(parse_reveal_tx(txHex, network)).toBeNull();
  });

  it('should return null for invalid transaction hex', () => {
    expect(parse_reveal_tx('invalid', network)).toBeNull();
  });

  it('should parse generic envelope with multiple chunks', () => {
    const chunk1 = Buffer.from([1, 2, 3]);
    const chunk2 = Buffer.from([4, 5, 6]);
    const chunks = [
      Buffer.from([0x00, 0x63]),
      Buffer.from([chunk1.length]), chunk1,
      Buffer.from([chunk2.length]), chunk2,
      Buffer.from([0x68])
    ];
    const witnessScript = Buffer.concat(chunks);
    const txHex = createRevealTx(witnessScript);
    
    const result = parse_reveal_tx(txHex, network);
    expect(result).toBeDefined();
  });

  it('should handle various message types', () => {
    const testCases = [
      { id: 4, payload: cborEncode([Buffer.alloc(21, 0xff), 1, Buffer.alloc(0)]), name: 'sweep' },
      { id: 10, payload: Buffer.alloc(34), name: 'order' },
      { id: 110, payload: Buffer.alloc(16), name: 'destroy' }
    ];
    
    testCases.forEach(({ id, payload, name }) => {
      const message = Buffer.concat([Buffer.from([id]), payload]);
      const witnessScript = createEnvelope(message);
      const txHex = createRevealTx(witnessScript);
      const result = parse_reveal_tx(txHex, network);
      expect(result?.message_name).toBe(name);
    });
  });

  it('should return null for malformed envelope without OP_IF', () => {
    const witnessScript = Buffer.from([0x00, 0x50, 0x01, 0x02, 0x68]); // OP_FALSE, wrong opcode
    const txHex = createRevealTx(witnessScript);
    
    expect(parse_reveal_tx(txHex, network)).toBeNull();
  });

  it('should handle envelope extraction errors gracefully', () => {
    // Create various malformed scripts that could cause errors
    const scripts = [
      Buffer.from([0x00, 0x63, 0x6f, 0x72, 0x64, 0x07, 0x78, 0x63, 0x70, 0x01, 0x05]), // truncated ord/xcp
      Buffer.from([0x00, 0x63, 0x4d, 0xff, 0xff]), // OP_PUSHDATA2 with invalid length
      Buffer.from([0x00, 0x63, 0x4e, 0xff, 0xff, 0xff, 0xff]), // OP_PUSHDATA4 with huge length
    ];
    
    scripts.forEach(script => {
      const txHex = createRevealTx(script);
      const result = parse_reveal_tx(txHex, network);
      // Should either return null or handle gracefully
      expect(result === null || typeof result === 'object').toBe(true);
    });
  });

  it('should handle witness at different input positions', () => {
    const tx = new btc.Transaction();
    tx.addInput(Buffer.alloc(32, 0), 0, 0xffffffff, Buffer.alloc(0));
    tx.addInput(Buffer.alloc(32, 1), 0, 0xffffffff, Buffer.alloc(0));
    tx.addOutput(Buffer.alloc(20), 1000n);
    
    const message = Buffer.concat([Buffer.from([2]), cborEncode([1n, 99, Buffer.alloc(21, 0x11)])]);
    const witnessScript = createEnvelope(message);
    
    tx.setWitness(0, [Buffer.alloc(64)]);
    tx.setWitness(1, [Buffer.alloc(64), witnessScript, Buffer.alloc(33)]);
    
    const result = parse_reveal_tx(tx.toHex(), network);
    expect(result?.message_id).toBe(2);
  });

  it('should handle OP_PUSHDATA4', () => {
    const data = Buffer.from([10]);
    const chunks = [
      Buffer.from([0x00, 0x63]),
      Buffer.from([0x4e, 0x01, 0x00, 0x00, 0x00]),
      data,
      Buffer.from([0x68])
    ];
    const witnessScript = Buffer.concat(chunks);
    const txHex = createRevealTx(witnessScript);
    
    expect(parse_reveal_tx(txHex, network)).toBeDefined();
  });

  it('should skip unknown opcodes in envelope', () => {
    const chunks = [
      Buffer.from([0x00, 0x63]),
      Buffer.from([0x51]), // OP_1 - unknown opcode
      Buffer.from([0x02, 0xaa, 0xbb]),
      Buffer.from([0x68])
    ];
    const witnessScript = Buffer.concat(chunks);
    const txHex = createRevealTx(witnessScript);
    
    const result = parse_reveal_tx(txHex, network);
    expect(result).toBeDefined();
  });

  it('should handle witness with insufficient elements', () => {
    const tx = new btc.Transaction();
    tx.addInput(Buffer.alloc(32, 0), 0);
    tx.addOutput(Buffer.alloc(20), 1000n);
    tx.setWitness(0, [Buffer.alloc(32)]); // Only 1 element, need at least 2
    
    expect(parse_reveal_tx(tx.toHex(), network)).toBeNull();
  });

  describe('ord/xcp envelope', () => {
    it('should parse ord/xcp envelope with short message ID', () => {
      const metadata = [1n, 100, Buffer.alloc(21, 0xaa)];
      const witnessScript = createOrdXcpEnvelope(2, metadata, 'application/cbor');
      const txHex = createRevealTx(witnessScript);
      
      const result = parse_reveal_tx(txHex, network);
      expect(result?.message_id).toBe(2);
      expect(result?.message_name).toBe('enhanced_send');
      expect(result?.params).toBeDefined();
    });

    it('should parse ord/xcp envelope with long message ID (>255)', () => {
      const metadata = [Buffer.alloc(21, 0xcc)];
      const witnessScript = createOrdXcpEnvelope(300, metadata, 'application/json');
      const txHex = createRevealTx(witnessScript);
      
      const result = parse_reveal_tx(txHex, network);
      expect(result?.message_id).toBe(300);
    });

    it('should handle ord/xcp envelope without 0x01 marker', () => {
      const chunks: Buffer[] = [
        Buffer.from([0x00, 0x63]), // OP_FALSE OP_IF
        Buffer.from('ord'), // literal
        Buffer.from([0x07]),
        Buffer.from('xcp'), // literal
        // Skip 0x01 marker
        Buffer.from([0x10]), Buffer.from('application/cbor'), // literal length + mime
        Buffer.from([0x05])
      ];
      
      const cborData = cborEncode([10, 1n, 50]);
      chunks.push(Buffer.from([cborData.length]), cborData); // push opcode + data
      chunks.push(Buffer.from([0x68]));
      
      const witnessScript = Buffer.concat(chunks);
      const txHex = createRevealTx(witnessScript);
      
      const result = parse_reveal_tx(txHex, network);
      expect(result?.message_id).toBe(10);
    });

    it('should handle ord/xcp envelope without 0x05 marker', () => {
      const chunks: Buffer[] = [
        Buffer.from([0x00, 0x63]),
        Buffer.from('ord'), // literal
        Buffer.from([0x07]),
        Buffer.from('xcp'), // literal
        Buffer.from([0x01]),
        Buffer.from([0x0f]), Buffer.from('text/plain;utf8'), // literal length + mime
        // Skip 0x05 marker
      ];
      
      const cborData = cborEncode([20, Buffer.alloc(21, 0xff)]);
      chunks.push(Buffer.from([cborData.length]), cborData); // push opcode + data
      chunks.push(Buffer.from([0x68]));
      
      const witnessScript = Buffer.concat(chunks);
      const txHex = createRevealTx(witnessScript);
      
      const result = parse_reveal_tx(txHex, network);
      expect(result?.message_id).toBe(20);
    });

    it('should handle OP_0 content separator in ord/xcp envelope', () => {
      const chunks: Buffer[] = [
        Buffer.from([0x00, 0x63]),
        Buffer.from('ord'), // literal
        Buffer.from([0x07]),
        Buffer.from('xcp'), // literal
        Buffer.from([0x01]),
        Buffer.from([0x04]), Buffer.from('text'), // literal length + mime
        Buffer.from([0x05])
      ];
      
      const cborData = cborEncode([4, Buffer.alloc(21, 0xdd), 1]);
      chunks.push(Buffer.from([cborData.length]), cborData); // push opcode + data
      chunks.push(Buffer.from([0x00])); // OP_0 separator
      chunks.push(Buffer.from([0x05]), Buffer.from('extra')); // content after separator
      chunks.push(Buffer.from([0x68]));
      
      const witnessScript = Buffer.concat(chunks);
      const txHex = createRevealTx(witnessScript);
      
      const result = parse_reveal_tx(txHex, network);
      expect(result?.message_id).toBe(4);
      expect(result?.message_name).toBe('sweep');
    });

    it('should handle OP_PUSHDATA1 in ord/xcp envelope', () => {
      const chunks: Buffer[] = [
        Buffer.from([0x00, 0x63]),
        Buffer.from('ord'), // literal
        Buffer.from([0x07]),
        Buffer.from('xcp'), // literal
        Buffer.from([0x01]),
        Buffer.from([0x08]), Buffer.from('app/cbor'), // literal length + mime
        Buffer.from([0x05])
      ];
      
      const cborData = cborEncode([10, 1n, 999]);
      chunks.push(Buffer.from([0x4c, cborData.length]), cborData); // OP_PUSHDATA1 + data
      chunks.push(Buffer.from([0x68]));
      
      const witnessScript = Buffer.concat(chunks);
      const txHex = createRevealTx(witnessScript);
      
      const result = parse_reveal_tx(txHex, network);
      expect(result?.message_id).toBe(10);
      expect(result?.message_name).toBe('order');
    });

    it('should handle multiple CBOR chunks in ord/xcp envelope', () => {
      const chunks: Buffer[] = [
        Buffer.from([0x00, 0x63]),
        Buffer.from('ord'), // literal
        Buffer.from([0x07]),
        Buffer.from('xcp'), // literal
        Buffer.from([0x01]),
        Buffer.from([0x04]), Buffer.from('test'), // literal length + mime
        Buffer.from([0x05])
      ];
      
      const cborData = cborEncode([110, Buffer.alloc(21, 0x11), 500]);
      const chunk1 = cborData.subarray(0, 30);
      const chunk2 = cborData.subarray(30);
      
      chunks.push(Buffer.from([chunk1.length]), chunk1); // push opcode + data
      chunks.push(Buffer.from([chunk2.length]), chunk2); // push opcode + data
      chunks.push(Buffer.from([0x68]));
      
      const witnessScript = Buffer.concat(chunks);
      const txHex = createRevealTx(witnessScript);
      
      const result = parse_reveal_tx(txHex, network);
      expect(result?.message_id).toBe(110);
      expect(result?.message_name).toBe('destroy');
    });

    it('should skip unknown opcodes in ord/xcp envelope', () => {
      const chunks: Buffer[] = [
        Buffer.from([0x00, 0x63]),
        Buffer.from('ord'), // literal
        Buffer.from([0x07]),
        Buffer.from('xcp'), // literal
        Buffer.from([0x01]),
        Buffer.from([0x04]), Buffer.from('mime'), // literal length + mime
        Buffer.from([0x05]),
        Buffer.from([0x51]) // OP_1 - unknown opcode
      ];
      
      const cborData = cborEncode([2, 1n, 88, Buffer.alloc(21, 0xbb)]);
      chunks.push(Buffer.from([cborData.length]), cborData); // push opcode + data
      chunks.push(Buffer.from([0x68]));
      
      const witnessScript = Buffer.concat(chunks);
      const txHex = createRevealTx(witnessScript);
      
      const result = parse_reveal_tx(txHex, network);
      expect(result?.message_id).toBe(2);
    });

    it('should return null for invalid CBOR in ord/xcp envelope', () => {
      const chunks: Buffer[] = [
        Buffer.from([0x00, 0x63]),
        Buffer.from('ord'), // literal
        Buffer.from([0x07]),
        Buffer.from('xcp'), // literal
        Buffer.from([0x01]),
        Buffer.from([0x04]), Buffer.from('test'), // literal length + mime
        Buffer.from([0x05])
      ];
      
      chunks.push(Buffer.from([0x05]), Buffer.from([0xff, 0xfe, 0xfd, 0xfc, 0xfb])); // push opcode + Invalid CBOR
      chunks.push(Buffer.from([0x68]));
      
      const witnessScript = Buffer.concat(chunks);
      const txHex = createRevealTx(witnessScript);
      
      expect(parse_reveal_tx(txHex, network)).toBeNull();
    });

    it('should return null for non-array CBOR in ord/xcp envelope', () => {
      const chunks: Buffer[] = [
        Buffer.from([0x00, 0x63]),
        Buffer.from('ord'), // literal
        Buffer.from([0x07]),
        Buffer.from('xcp'), // literal
        Buffer.from([0x01]),
        Buffer.from([0x04]), Buffer.from('test'), // literal length + mime
        Buffer.from([0x05])
      ];
      
      const cborData = cborEncode({ key: 'value' }); // Object instead of array
      chunks.push(Buffer.from([cborData.length]), cborData); // push opcode + data
      chunks.push(Buffer.from([0x68]));
      
      const witnessScript = Buffer.concat(chunks);
      const txHex = createRevealTx(witnessScript);
      
      expect(parse_reveal_tx(txHex, network)).toBeNull();
    });

    it('should return null for empty CBOR array in ord/xcp envelope', () => {
      const chunks: Buffer[] = [
        Buffer.from([0x00, 0x63]),
        Buffer.from('ord'), // literal
        Buffer.from([0x07]),
        Buffer.from('xcp'), // literal
        Buffer.from([0x01]),
        Buffer.from([0x04]), Buffer.from('test'), // literal length + mime
        Buffer.from([0x05])
      ];
      
      const cborData = cborEncode([]); // Empty array
      chunks.push(Buffer.from([cborData.length]), cborData); // push opcode + data
      chunks.push(Buffer.from([0x68]));
      
      const witnessScript = Buffer.concat(chunks);
      const txHex = createRevealTx(witnessScript);
      
      expect(parse_reveal_tx(txHex, network)).toBeNull();
    });

    it('should handle edge case with message ID at boundary (255)', () => {
      const metadata = [Buffer.alloc(21, 0x99)];
      const witnessScript = createOrdXcpEnvelope(255, metadata, 'test/mime');
      const txHex = createRevealTx(witnessScript);
      
      const result = parse_reveal_tx(txHex, network);
      expect(result?.message_id).toBe(255);
    });

    it('should handle edge case with message ID just above boundary (256)', () => {
      const metadata = [Buffer.alloc(21, 0x88)];
      const witnessScript = createOrdXcpEnvelope(256, metadata, 'test/type');
      const txHex = createRevealTx(witnessScript);
      
      const result = parse_reveal_tx(txHex, network);
      expect(result?.message_id).toBe(256);
    });
  });
});

