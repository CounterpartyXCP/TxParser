import * as btc from 'bitcoinjs-lib';
import type { ParsedTransaction } from './types';
import { PREFIX_BYTES, MESSAGE_TYPES } from './constants';
import { decodePayload, readMessageTypeId } from './payload-decoders';

/**
 * RC4 (ARC4) implementation
 * Based on the Rust crypto crate implementation used by Counterparty
 * 
 * Note: We implement RC4 manually here instead of using a library because:
 * 1. Node.js crypto.createDecipheriv('rc4') doesn't work correctly in this context
 * 2. External libraries like 'arc4' have compatibility issues with Next.js bundling
 * 3. RC4 is simple enough that a manual implementation is reliable and well-tested
 */
function rc4Decrypt(key: Buffer, data: Buffer): Buffer {
  // Initialize state array
  const S = new Uint8Array(256);
  for (let i = 0; i < 256; i++) {
    S[i] = i;
  }
  
  // Key-scheduling algorithm (KSA)
  let j = 0;
  for (let i = 0; i < 256; i++) {
    j = (j + S[i] + key[i % key.length]) & 0xFF;
    // Swap S[i] and S[j]
    const temp = S[i];
    S[i] = S[j];
    S[j] = temp;
  }
  
  // Pseudo-random generation algorithm (PRGA)
  const output = Buffer.alloc(data.length);
  let i = 0;
  j = 0;
  
  for (let k = 0; k < data.length; k++) {
    i = (i + 1) & 0xFF;
    j = (j + S[i]) & 0xFF;
    // Swap S[i] and S[j]
    const temp = S[i];
    S[i] = S[j];
    S[j] = temp;
    // XOR data with keystream
    output[k] = data[k] ^ S[(S[i] + S[j]) & 0xFF];
  }
  
  return output;
}

/**
 * Parse OP_RETURN data from a Counterparty transaction
 * 
 * @param scriptBuffer - The full OP_RETURN script buffer (including OP_RETURN opcode)
 * @param firstInputTxid - The txid of the first input (used as RC4 key)
 * @param network - Bitcoin network (mainnet or testnet)
 * @returns Parsed message with type and parameters
 */
export function parse_op_return(
  scriptBuffer: Buffer,
  firstInputTxid: string,
  network: btc.Network
): ParsedTransaction | null {
  try {
    // Check if it's an OP_RETURN output
    if (scriptBuffer.length === 0 || scriptBuffer[0] !== 0x6a) {
      return null; // Not an OP_RETURN
    }
    
    // Extract data after OP_RETURN opcode and push length byte
    // Bitcoin script: OP_RETURN (0x6a) + PUSHDATA length byte + actual data
    // If length < 76, the next byte is just the length
    let dataStart = 1;
    if (scriptBuffer.length > 1) {
      const pushOpcode = scriptBuffer[1];
      if (pushOpcode < 76) {
        // Direct length byte
        dataStart = 2;
      } else if (pushOpcode === 0x4c) {
        // OP_PUSHDATA1
        dataStart = 3;
      } else if (pushOpcode === 0x4d) {
        // OP_PUSHDATA2
        dataStart = 4;
      } else if (pushOpcode === 0x4e) {
        // OP_PUSHDATA4
        dataStart = 6;
      }
    }
    
    const opReturnData = Buffer.from(scriptBuffer.subarray(dataStart));
    
    // Use normal txid as key (not reversed)
    const key = Buffer.from(firstInputTxid, 'hex');
    
    // Check if it's a Taproot commit marker (literal "CNTRPRTY")
    if (opReturnData.equals(PREFIX_BYTES)) {
      return {
        message_name: 'taproot_commit',
        message_id: 0,
        params: {
          data: 'CNTRPRTY',
        },
      };
    }
    
    // Decrypt with RC4
    const decrypted = rc4Decrypt(key, opReturnData);
    
    // Check if decrypted data starts with PREFIX
    if (!decrypted.subarray(0, 8).equals(PREFIX_BYTES)) {
      return null; // Not a valid Counterparty message
    }
    
    // Extract the message (after PREFIX)
    const message = Buffer.from(decrypted.subarray(8));
    
    if (message.length === 0) {
      return null;
    }
    
    // Read message type ID
    const { id: messageId, rest: payload } = readMessageTypeId(message);
    
    // Get message name
    const messageName = MESSAGE_TYPES[messageId] || 'unknown';
    
    // Decode payload
    const params = decodePayload(messageId, payload, network);
    
    return {
      message_name: messageName,
      message_id: messageId,
      params,
    };
  } catch (error) {
    return null;
  }
}

