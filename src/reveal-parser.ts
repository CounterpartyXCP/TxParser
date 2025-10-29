import { decode as cborDecode, encode as cborEncode } from 'cbor-x';
import * as btc from 'bitcoinjs-lib';
import type { ParsedTransaction } from './types';
import { MESSAGE_TYPES } from './constants';
import { decodePayload, readMessageTypeId } from './payload-decoders';

/**
 * Extract witness script from a Bitcoin transaction using bitcoinjs-lib
 * Returns the witness script that may contain Counterparty envelope data
 */
function extractWitnessScript(txBuffer: Buffer): Buffer | null {
  try {
    // Parse the transaction using bitcoinjs-lib
    const tx = btc.Transaction.fromBuffer(txBuffer);
    
    // Check if transaction has witness data
    if (!tx.hasWitnesses()) {
      return null;
    }
    
    // Iterate through all inputs to find a witness with envelope script
    for (const input of tx.ins) {
      if (!input.witness || input.witness.length < 2) {
        continue;
      }
      
      // In Taproot: [signature, script, control_block]
      // The script is usually the second-to-last item
      const script = input.witness[input.witness.length - 2];
      
      // Check if it looks like an envelope script (starts with OP_FALSE OP_IF)
      // OP_FALSE = 0x00, OP_IF = 0x63
      if (script && script.length > 2 && script[0] === 0x00 && script[1] === 0x63) {
        return Buffer.from(script);
      }
    }
    
    return null;
  } catch (error) {
    return null;
  }
}

/**
 * Extract message data from Taproot envelope script
 * Supports both generic and ord/xcp envelope formats
 */
function extractFromEnvelope(script: Buffer): Buffer | null {
  try {
    // Check for OP_FALSE OP_IF pattern
    if (script.length < 4 || script[0] !== 0x00 || script[1] !== 0x63) {
      return null;
    }
    
    let offset = 2; // Skip OP_FALSE OP_IF
    
    // Check if this is an ord/xcp envelope
    // Pattern: "ord" 0x07 "xcp" 0x01 <mime_type> 0x05 <CBOR metadata chunks...>
    if (offset + 3 <= script.length) {
      const possibleOrd = script.subarray(offset, offset + 3);
      if (possibleOrd.toString('utf8') === 'ord') {
        offset += 3;
        
        // Skip the length byte before "ord" if present
        if (script[offset] === 0x07) {
          offset += 1;
        }
        
        // Check for "xcp"
        if (offset + 3 <= script.length) {
          const possibleXcp = script.subarray(offset, offset + 3);
          if (possibleXcp.toString('utf8') === 'xcp') {
            offset += 3;
            
            // This is an ord/xcp envelope
            return extractOrdXcpEnvelope(script, offset);
          }
        }
      }
    }
    
    // Generic envelope: just concatenate all pushed data until OP_ENDIF
    return extractGenericEnvelope(script, 2);
  } catch (error) {
    return null;
  }
}

/**
 * Extract data from ord/xcp envelope
 */
function extractOrdXcpEnvelope(script: Buffer, startOffset: number): Buffer | null {
  try {
    let offset = startOffset;
    
    // Skip 0x01 marker
    if (script[offset] === 0x01) {
      offset += 1;
    }
    
    // Read mime_type
    const mimeTypeLen = script[offset];
    offset += 1;
    const mimeType = script.subarray(offset, offset + mimeTypeLen);
    offset += mimeTypeLen;
    
    // Skip 0x05 marker
    if (script[offset] === 0x05) {
      offset += 1;
    }
    
    // Collect CBOR metadata chunks until we hit OP_0/OP_FALSE or content marker
    const cborChunks: Buffer[] = [];
    
    while (offset < script.length) {
      const byte = script[offset];
      
      // Check for OP_ENDIF (0x68)
      if (byte === 0x68) {
        break;
      }
      
      // Check for OP_0/OP_FALSE (content separator)
      if (byte === 0x00) {
        offset += 1;
        // Content chunks follow, but we don't need them for Counterparty data
        break;
      }
      
      // This is a push operation
      if (byte > 0 && byte <= 75) {
        // Direct push (OP_PUSHBYTES_N)
        const chunkLen = byte;
        offset += 1;
        const chunk = script.subarray(offset, offset + chunkLen);
        cborChunks.push(chunk);
        offset += chunkLen;
      } else if (byte === 0x4c) {
        // OP_PUSHDATA1
        const chunkLen = script[offset + 1];
        offset += 2;
        const chunk = script.subarray(offset, offset + chunkLen);
        cborChunks.push(chunk);
        offset += chunkLen;
      } else {
        offset += 1;
      }
    }
    
    // Concatenate CBOR chunks and decode
    const cborData = Buffer.concat(cborChunks);
    const decoded = cborDecode(cborData);
    
    if (!Array.isArray(decoded) || decoded.length === 0) {
      return null;
    }
    
    // Extract message_type_id (first element)
    const messageTypeId = decoded[0];
    
    // Remove message_type_id from array and append mime_type
    const modifiedArray = decoded.slice(1);
    modifiedArray.push(mimeType.toString('utf8'));
    // Content would be appended here if present, but we skip it
    
    // Re-encode as CBOR
    const reencoded = cborEncode(modifiedArray);
    
    // Prefix with message_type_id byte
    let messageTypeIdByte: Buffer;
    if (messageTypeId > 0 && messageTypeId < 256) {
      messageTypeIdByte = Buffer.from([messageTypeId]);
    } else {
      const longIdBuffer = Buffer.alloc(5);
      longIdBuffer[0] = 0;
      longIdBuffer.writeUInt32BE(messageTypeId, 1);
      messageTypeIdByte = longIdBuffer;
    }
    
    return Buffer.concat([messageTypeIdByte, Buffer.from(reencoded)]);
  } catch (error) {
    return null;
  }
}

/**
 * Extract data from generic envelope
 * Concatenates all pushed chunks between OP_IF and OP_ENDIF
 */
function extractGenericEnvelope(script: Buffer, startOffset: number): Buffer | null {
  try {
    const chunks: Buffer[] = [];
    let offset = startOffset;
    
    while (offset < script.length) {
      const byte = script[offset];
      
      // Check for OP_ENDIF (0x68)
      if (byte === 0x68) {
        break;
      }
      
      // Handle push operations
      if (byte > 0 && byte <= 75) {
        // Direct push (OP_PUSHBYTES_N)
        const chunkLen = byte;
        offset += 1;
        const chunk = script.subarray(offset, offset + chunkLen);
        chunks.push(chunk);
        offset += chunkLen;
      } else if (byte === 0x4c) {
        // OP_PUSHDATA1
        const chunkLen = script[offset + 1];
        offset += 2;
        const chunk = script.subarray(offset, offset + chunkLen);
        chunks.push(chunk);
        offset += chunkLen;
      } else if (byte === 0x4d) {
        // OP_PUSHDATA2
        const chunkLen = script.readUInt16LE(offset + 1);
        offset += 3;
        const chunk = script.subarray(offset, offset + chunkLen);
        chunks.push(chunk);
        offset += chunkLen;
      } else if (byte === 0x4e) {
        // OP_PUSHDATA4
        const chunkLen = script.readUInt32LE(offset + 1);
        offset += 5;
        const chunk = script.subarray(offset, offset + chunkLen);
        chunks.push(chunk);
        offset += chunkLen;
      } else {
        // Skip unknown opcodes
        offset += 1;
      }
    }
    
    // Concatenate all chunks
    return Buffer.concat(chunks);
  } catch (error) {
    return null;
  }
}

/**
 * Parse Taproot reveal transaction to extract Counterparty data
 * 
 * @param revealTxHex - The raw reveal transaction as hex string
 * @param network - Bitcoin network (mainnet or testnet)
 * @returns Parsed message with type and parameters
 */
export function parse_reveal_tx(
  revealTxHex: string,
  network: btc.Network
): ParsedTransaction | null {
  try {
    const txBuffer = Buffer.from(revealTxHex, 'hex');
    
    // Extract witness script
    const witnessScript = extractWitnessScript(txBuffer);
    if (!witnessScript) {
      return null;
    }
    
    // Extract message from envelope
    const message = extractFromEnvelope(witnessScript);
    if (!message || message.length === 0) {
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

