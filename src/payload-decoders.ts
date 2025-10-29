import { decode as cborDecode } from 'cbor-x';
import * as btc from 'bitcoinjs-lib';
import type {
  EnhancedSendPayload,
  SweepPayload,
  IssuancePayload,
  IssuanceSubassetPayload,
  BroadcastPayload,
  FairminterPayload,
  FairmintPayload,
  AttachPayload,
  DetachPayload,
  OrderPayload,
  BtcPayPayload,
  DispenserPayload,
  DispensePayload,
  DividendPayload,
  CancelPayload,
  DestroyPayload,
  TransactionPayload,
} from './types';

/**
 * Convert asset_id to asset name according to Counterparty protocol
 * 
 * Rules (all protocol changes enabled):
 * - 0 → BTC, 1 → XCP
 * - If asset_id >= 26^12 + 1: numeric asset → "A" + str(asset_id)
 * - Else if asset_id >= 26^3: alphabetic base-26 using A..Z
 */
export function assetIdToName(assetId: string | bigint): string {
  const id = typeof assetId === 'string' ? BigInt(assetId) : assetId;
  
  // Special cases
  if (id === BigInt(0)) return 'BTC';
  if (id === BigInt(1)) return 'XCP';
  
  const NUMERIC_THRESHOLD = BigInt(26) ** BigInt(12) + BigInt(1); // 95428956661682176 + 1
  const ALPHABETIC_THRESHOLD = BigInt(26) ** BigInt(3); // 17576
  
  // Numeric assets: >= 26^12 + 1
  if (id >= NUMERIC_THRESHOLD) {
    return `A${id.toString()}`;
  }
  
  // Alphabetic assets: >= 26^3
  if (id >= ALPHABETIC_THRESHOLD) {
    // Convert to base-26 alphabetic (A=1, B=2, ..., Z=26)
    // Similar to Excel column naming
    let remaining = id;
    let name = '';
    
    while (remaining > BigInt(0)) {
      remaining = remaining - BigInt(1); // Make it 1-based
      const digit = remaining % BigInt(26);
      name = String.fromCharCode(65 + Number(digit)) + name; // 65 = 'A'
      remaining = remaining / BigInt(26);
    }
    
    return name;
  }
  
  // Below threshold: numeric representation
  return `A${id.toString()}`;
}

/**
 * Convert short_address_bytes (variable length hex string) to full Bitcoin address
 * 
 * Format (all protocol changes enabled):
 * - Legacy P2PKH/P2SH: 1-byte version/tag + hash → Base58Check
 * - Segwit marker: if first byte is 0x80..0x8F, it's 0x80 + witver followed by witness program → Bech32/Bech32m
 * - Generalized tags:
 *   - 0x01 + hash (typically 20 bytes) → P2PKH
 *   - 0x02 + hash (typically 20 bytes) → P2SH
 *   - 0x03 + 1-byte witness version + witness program (20 bytes for P2WPKH, 32 bytes for P2TR) → Bech32/Bech32m
 */
export function shortAddressBytesToAddress(shortAddressHex: string, network: btc.Network): string {
  try {
    const btcNetwork = network;
    
    const buffer = Buffer.from(shortAddressHex, 'hex');
    
    // Accept any reasonable length (at least 2 bytes: tag + some data)
    if (buffer.length < 2) {
      throw new Error(`Invalid short address length: ${buffer.length}`);
    }
    
    const firstByte = buffer[0];
    const data = buffer.subarray(1);
    
    // Generalized tags (0x01, 0x02, 0x03)
    if (firstByte === 0x01) {
      // P2PKH - use all remaining bytes as hash (typically 20 bytes)
      const payment = btc.payments.p2pkh({ hash: data, network: btcNetwork });
      return payment.address || `0x${shortAddressHex}`;
    } else if (firstByte === 0x02) {
      // P2SH - use all remaining bytes as hash (typically 20 bytes)
      const payment = btc.payments.p2sh({ hash: data, network: btcNetwork });
      return payment.address || `0x${shortAddressHex}`;
    } else if (firstByte === 0x03) {
      // Segwit format: 0x03 + witness_version (1 byte) + witness program (variable length)
      // P2WPKH: 22 bytes total (tag + version + 20-byte program)
      // P2TR: 34 bytes total (tag + version + 32-byte program)
      
      if (data.length >= 2) {
        const witnessVersion = data[0];
        const witnessProgram = data.subarray(1);
        
        if (witnessVersion === 0 && witnessProgram.length === 20) {
          // P2WPKH: witness version 0 with 20-byte hash160
          const payment = btc.payments.p2wpkh({ hash: witnessProgram, network: btcNetwork });
          if (payment.address) return payment.address;
        } else if (witnessVersion === 0 && witnessProgram.length === 32) {
          // P2WSH: witness version 0 with 32-byte script hash
          const payment = btc.payments.p2wsh({ hash: witnessProgram, network: btcNetwork });
          if (payment.address) return payment.address;
        } else if (witnessVersion === 1 && witnessProgram.length === 32) {
          // P2TR (Taproot): witness version 1 with 32-byte pubkey
          const payment = btc.payments.p2tr({ pubkey: witnessProgram, network: btcNetwork });
          if (payment.address) return payment.address;
        }
      }
      
      return `0x${shortAddressHex}`;
    }
    
    // Segwit marker (0x80..0x8F)
    if (firstByte >= 0x80 && firstByte <= 0x8f) {
      const witnessVersion = firstByte - 0x80;
      
      if (witnessVersion === 0 && data.length === 20) {
        // P2WPKH: witness version 0 with 20-byte hash
        const payment = btc.payments.p2wpkh({ hash: data, network: btcNetwork });
        return payment.address || `0x${shortAddressHex}`;
      } else if (witnessVersion === 0 && data.length === 32) {
        // P2WSH: witness version 0 with 32-byte hash
        const payment = btc.payments.p2wsh({ hash: data, network: btcNetwork });
        return payment.address || `0x${shortAddressHex}`;
      } else if (witnessVersion === 1 && data.length === 32) {
        // P2TR: witness version 1 with 32-byte pubkey
        const payment = btc.payments.p2tr({ pubkey: data, network: btcNetwork });
        return payment.address || `0x${shortAddressHex}`;
      }
    }
    
    // Legacy Base58Check (default)
    // Use the network's standard versions
    if (firstByte === btcNetwork.pubKeyHash) {
      const payment = btc.payments.p2pkh({ hash: data, network: btcNetwork });
      return payment.address || `0x${shortAddressHex}`;
    } else if (firstByte === btcNetwork.scriptHash) {
      const payment = btc.payments.p2sh({ hash: data, network: btcNetwork });
      return payment.address || `0x${shortAddressHex}`;
    }
    
    // Unknown version byte - return hex
    return `0x${shortAddressHex}`;
  } catch (error) {
    // Return hex if conversion fails
    return `0x${shortAddressHex}`;
  }
}

/**
 * Try to decode buffer as UTF-8 if mime type is empty or text-based
 * Falls back to hex if UTF-8 decoding fails
 */
export function decodeTextOrHex(buffer: Buffer, mimeType: string): string {
  const mimeTypeLower = (mimeType || '').toLowerCase().trim();
  const isTextType = mimeTypeLower === '' || mimeTypeLower.startsWith('text');
  
  if (isTextType) {
    try {
      // Try to decode as UTF-8
      const decoded = buffer.toString('utf8');
      // Check if the decoded string is valid UTF-8 (no replacement characters)
      // This is a heuristic - we check if re-encoding gives us back the same buffer
      if (Buffer.from(decoded, 'utf8').equals(buffer)) {
        return decoded;
      }
    } catch {
      // Fall through to hex
    }
  }
  
  // Return hex for non-text types or if UTF-8 decoding failed
  return buffer.toString('hex');
}

/**
 * Read message type ID from the message buffer
 * Returns 1 byte if 0 < ID < 256; otherwise 4 bytes big-endian
 */
export function readMessageTypeId(message: Buffer): { id: number; rest: Buffer } {
  if (message.length === 0) {
    throw new Error('Empty message');
  }
  
  const firstByte = message[0];
  
  if (firstByte > 0) {
    // Short ID (1 byte)
    return {
      id: firstByte,
      rest: Buffer.from(message.subarray(1)),
    };
  } else {
    // Long ID (4 bytes big-endian)
    if (message.length < 5) {
      throw new Error('Message too short for long ID');
    }
    return {
      id: message.readUInt32BE(1),
      rest: Buffer.from(message.subarray(5)),
    };
  }
}

/**
 * Decode Enhanced Send (ID = 2)
 * CBOR array: [asset_id:uint64, quantity:int, short_address_bytes:21, memo:bytes]
 */
export function decodeEnhancedSend(payload: Buffer, network: btc.Network): EnhancedSendPayload {
  const decoded = cborDecode(payload);
  
  if (!Array.isArray(decoded) || decoded.length < 3) {
    throw new Error('Invalid enhanced send payload');
  }
  
  const assetId = decoded[0]?.toString();
  const shortAddressBytes = Buffer.isBuffer(decoded[2]) 
    ? decoded[2].toString('hex') 
    : Buffer.from(decoded[2]).toString('hex');
  
  return {
    asset: assetIdToName(assetId),
    quantity: decoded[1]?.toString(),
    address: shortAddressBytesToAddress(shortAddressBytes, network),
    memo: decoded[3] 
      ? (Buffer.isBuffer(decoded[3]) 
          ? decoded[3].toString('hex') 
          : Buffer.from(decoded[3]).toString('hex'))
      : '',
  };
}

/**
 * Decode Sweep (ID = 4)
 * CBOR array: [short_address_bytes:21, flags:uint8, memo:bytes]
 */
export function decodeSweep(payload: Buffer, network: btc.Network): SweepPayload {
  const decoded = cborDecode(payload);
  
  if (!Array.isArray(decoded) || decoded.length < 2) {
    throw new Error('Invalid sweep payload');
  }
  
  const shortAddressBytes = Buffer.isBuffer(decoded[0])
    ? decoded[0].toString('hex')
    : Buffer.from(decoded[0]).toString('hex');
  
  return {
    address: shortAddressBytesToAddress(shortAddressBytes, network),
    flags: decoded[1],
    memo: decoded[2]
      ? (Buffer.isBuffer(decoded[2])
          ? decoded[2].toString('hex')
          : Buffer.from(decoded[2]).toString('hex'))
      : '',
  };
}

/**
 * Decode Issuance (ID = 20, 22)
 * CBOR array: [asset_id:uint64, quantity:int, divisible:bool, lock:bool, reset:bool, mime_type:text, description:bytes|null]
 */
export function decodeIssuance(payload: Buffer): IssuancePayload {
  const decoded = cborDecode(payload);
  
  if (!Array.isArray(decoded) || decoded.length < 5) {
    throw new Error('Invalid issuance payload');
  }
  
  const assetId = decoded[0]?.toString();
  const mimeType = decoded[5] || '';
  
  let description = null;
  if (decoded[6]) {
    const descBuffer = Buffer.isBuffer(decoded[6]) ? decoded[6] : Buffer.from(decoded[6]);
    description = decodeTextOrHex(descBuffer, mimeType);
  }
  
  return {
    asset: assetIdToName(assetId),
    quantity: decoded[1]?.toString(),
    divisible: decoded[2],
    lock: decoded[3],
    reset: decoded[4],
    mime_type: mimeType,
    description,
  };
}

/**
 * Decode Issuance Subasset (ID = 21, 23)
 * CBOR array: [asset_id:uint64, quantity:int, divisible:int(0|1), lock:int(0|1), reset:int(0|1), 
 *              compacted_subasset_length:int, compacted_subasset_longname:bytes, mime_type:text, description:bytes|null]
 */
export function decodeIssuanceSubasset(payload: Buffer): IssuanceSubassetPayload {
  const decoded = cborDecode(payload);
  
  if (!Array.isArray(decoded) || decoded.length < 7) {
    throw new Error('Invalid issuance subasset payload');
  }
  
  const assetId = decoded[0]?.toString();
  const mimeType = decoded[7] || '';
  
  let description = null;
  if (decoded[8]) {
    const descBuffer = Buffer.isBuffer(decoded[8]) ? decoded[8] : Buffer.from(decoded[8]);
    description = decodeTextOrHex(descBuffer, mimeType);
  }
  
  return {
    asset: assetIdToName(assetId),
    quantity: decoded[1]?.toString(),
    divisible: decoded[2],
    lock: decoded[3],
    reset: decoded[4],
    compacted_subasset_length: decoded[5],
    compacted_subasset_longname: Buffer.isBuffer(decoded[6])
      ? decoded[6].toString('hex')
      : Buffer.from(decoded[6]).toString('hex'),
    mime_type: mimeType,
    description,
  };
}

/**
 * Decode Broadcast (ID = 30)
 * CBOR array: [timestamp:int, value:float, fee_fraction_int:uint32, mime_type:text, text:bytes]
 */
export function decodeBroadcast(payload: Buffer): BroadcastPayload {
  const decoded = cborDecode(payload);
  
  if (!Array.isArray(decoded) || decoded.length < 4) {
    throw new Error('Invalid broadcast payload');
  }
  
  const mimeType = decoded[3] || '';
  
  let text = '';
  if (decoded[4]) {
    const textBuffer = Buffer.isBuffer(decoded[4]) ? decoded[4] : Buffer.from(decoded[4]);
    text = decodeTextOrHex(textBuffer, mimeType);
  }
  
  return {
    timestamp: decoded[0],
    value: decoded[1],
    fee_fraction_int: decoded[2],
    mime_type: mimeType,
    text,
  };
}

/**
 * Decode Fairminter (ID = 90)
 * CBOR array with multiple fields
 */
export function decodeFairminter(payload: Buffer): FairminterPayload {
  const decoded = cborDecode(payload);
  
  if (!Array.isArray(decoded) || decoded.length < 17) {
    throw new Error('Invalid fairminter payload');
  }
  
  const assetId = decoded[0]?.toString();
  const assetParentId = decoded[1]?.toString();
  const mimeType = decoded[17] || '';
  
  let description = '';
  if (decoded[18]) {
    const descBuffer = Buffer.isBuffer(decoded[18]) ? decoded[18] : Buffer.from(decoded[18]);
    description = decodeTextOrHex(descBuffer, mimeType);
  }
  
  return {
    asset: assetIdToName(assetId),
    asset_parent: assetIdToName(assetParentId),
    price: decoded[2]?.toString(),
    quantity_by_price: decoded[3]?.toString(),
    max_mint_per_tx: decoded[4]?.toString(),
    max_mint_per_address: decoded[5]?.toString(),
    hard_cap: decoded[6]?.toString(),
    premint_quantity: decoded[7]?.toString(),
    start_block: decoded[8],
    end_block: decoded[9],
    soft_cap: decoded[10]?.toString(),
    soft_cap_deadline_block: decoded[11],
    minted_asset_commission_int: decoded[12],
    burn_payment: decoded[13],
    lock_description: decoded[14],
    lock_quantity: decoded[15],
    divisible: decoded[16],
    mime_type: mimeType,
    description,
  };
}

/**
 * Decode Fairmint (ID = 91)
 * CBOR array: [asset_id:uint64, quantity:int]
 */
export function decodeFairmint(payload: Buffer): FairmintPayload {
  const decoded = cborDecode(payload);
  
  if (!Array.isArray(decoded) || decoded.length < 2) {
    throw new Error('Invalid fairmint payload');
  }
  
  const assetId = decoded[0]?.toString();
  
  return {
    asset: assetIdToName(assetId),
    quantity: decoded[1]?.toString(),
  };
}

/**
 * Decode Attach (ID = 101)
 * UTF-8 string format: "asset|quantity|destination_vout"
 */
export function decodeAttach(payload: Buffer): AttachPayload {
  const raw = payload.toString('utf8');
  const parts = raw.split('|');
  
  if (parts.length < 2) {
    throw new Error('Invalid attach payload');
  }
  
  return {
    asset: parts[0] || '',
    quantity: parts[1] || '',
    destination_vout: parts[2] || '',
  };
}

/**
 * Decode Detach (ID = 102)
 * UTF-8 address or single byte 0x30 (meaning "self")
 */
export function decodeDetach(payload: Buffer): DetachPayload {
  // Single byte 0x30 means credit back to source
  if (payload.length === 1 && payload[0] === 0x30) {
    return {
      destination: 'self',
    };
  }
  
  // Otherwise it's a destination address
  return {
    destination: payload.toString('utf8'),
  };
}

/**
 * Decode Order (ID = 10)
 * Binary struct >QQQQHQ: [give_id:uint64, give_quantity:int64, get_id:uint64, get_quantity:int64, expiration:uint16, fee_required:int64]
 */
export function decodeOrder(payload: Buffer): OrderPayload {
  if (payload.length < 34) {
    throw new Error('Invalid order payload');
  }
  
  const giveId = payload.readBigUInt64BE(0).toString();
  const getId = payload.readBigUInt64BE(16).toString();
  
  return {
    give_asset: assetIdToName(giveId),
    give_quantity: payload.readBigInt64BE(8).toString(),
    get_asset: assetIdToName(getId),
    get_quantity: payload.readBigInt64BE(24).toString(),
    expiration: payload.readUInt16BE(32),
    fee_required: payload.length >= 42 ? payload.readBigInt64BE(34).toString() : '0',
  };
}

/**
 * Decode BTC Pay (ID = 11)
 * Binary struct >32s32s: [tx0_hash:32 bytes, tx1_hash:32 bytes]
 */
export function decodeBtcPay(payload: Buffer): BtcPayPayload {
  if (payload.length < 64) {
    throw new Error('Invalid btc_pay payload');
  }
  
  return {
    tx0_hash: payload.subarray(0, 32).toString('hex'),
    tx1_hash: payload.subarray(32, 64).toString('hex'),
  };
}

/**
 * Decode Dispenser (ID = 12)
 * Binary struct >QQQQB: [asset_id:uint64, give_quantity:int64, escrow_quantity:int64, satoshirate:int64, status:uint8]
 * Optionally followed by action_address (21 bytes) and oracle_address (21 bytes)
 */
export function decodeDispenser(payload: Buffer, network: btc.Network): DispenserPayload {
  if (payload.length < 33) {
    throw new Error('Invalid dispenser payload');
  }
  
  const assetId = payload.readBigUInt64BE(0).toString();
  
  const result: DispenserPayload = {
    asset: assetIdToName(assetId),
    give_quantity: payload.readBigInt64BE(8).toString(),
    escrow_quantity: payload.readBigInt64BE(16).toString(),
    satoshirate: payload.readBigInt64BE(24).toString(),
    status: payload.readUInt8(32),
  };
  
  // Optional packed addresses
  if (payload.length >= 54) {
    const actionAddressBytes = payload.subarray(33, 54).toString('hex');
    result.action_address = shortAddressBytesToAddress(actionAddressBytes, network);
  }
  if (payload.length >= 75) {
    const oracleAddressBytes = payload.subarray(54, 75).toString('hex');
    result.oracle_address = shortAddressBytesToAddress(oracleAddressBytes, network);
  }
  
  return result;
}

/**
 * Decode Dispense (ID = 13)
 * Minimal payload: 0x00 (single zero byte)
 */
export function decodeDispense(payload: Buffer): DispensePayload {
  if (payload.length !== 1 || payload[0] !== 0x00) {
    throw new Error('Invalid dispense payload: expected 0x00');
  }
  return {
    data: '0x00',
  };
}

/**
 * Decode Dividend (ID = 50)
 * Binary struct >QQQ or >QQ: [quantity_per_unit:int64, asset_id:uint64, dividend_asset_id:uint64 (optional)]
 */
export function decodeDividend(payload: Buffer): DividendPayload {
  if (payload.length < 16) {
    throw new Error('Invalid dividend payload');
  }
  
  const assetId = payload.readBigUInt64BE(8).toString();
  
  const result: DividendPayload = {
    quantity_per_unit: payload.readBigInt64BE(0).toString(),
    asset: assetIdToName(assetId),
    dividend_asset: 'XCP', // Default value, will be overwritten if present
  };
  
  // New format includes dividend_asset_id
  if (payload.length >= 24) {
    const dividendAssetId = payload.readBigUInt64BE(16).toString();
    result.dividend_asset = assetIdToName(dividendAssetId);
  }
  
  return result;
}

/**
 * Decode Cancel (ID = 70)
 * Binary struct >32s: [offer_hash:32 bytes]
 */
export function decodeCancel(payload: Buffer): CancelPayload {
  if (payload.length < 32) {
    throw new Error('Invalid cancel payload');
  }
  
  return {
    offer_hash: payload.subarray(0, 32).toString('hex'),
  };
}

/**
 * Decode Destroy (ID = 110)
 * Binary struct >QQ: [asset_id:uint64, quantity:int64] + optional tag (up to 34 bytes)
 */
export function decodeDestroy(payload: Buffer): DestroyPayload {
  if (payload.length < 16) {
    throw new Error('Invalid destroy payload');
  }
  
  const assetId = payload.readBigUInt64BE(0).toString();
  
  const result: DestroyPayload = {
    asset: assetIdToName(assetId),
    quantity: payload.readBigInt64BE(8).toString(),
  };
  
  // Optional tag
  if (payload.length > 16) {
    const tagBytes = payload.subarray(16, Math.min(payload.length, 50));
    result.tag = tagBytes.toString('hex');
  }
  
  return result;
}

/**
 * Decode message payload based on message type
 */
export function decodePayload(messageId: number, payload: Buffer, network: btc.Network): TransactionPayload {
  try {
    switch (messageId) {
      case 2:
        return decodeEnhancedSend(payload, network);
      case 4:
        return decodeSweep(payload, network);
      case 10:
        return decodeOrder(payload);
      case 11:
        return decodeBtcPay(payload);
      case 12:
        return decodeDispenser(payload, network);
      case 13:
        return decodeDispense(payload);
      case 20:
      case 22:
        return decodeIssuance(payload);
      case 21:
      case 23:
        return decodeIssuanceSubasset(payload);
      case 30:
        return decodeBroadcast(payload);
      case 50:
        return decodeDividend(payload);
      case 70:
        return decodeCancel(payload);
      case 90:
        return decodeFairminter(payload);
      case 91:
        return decodeFairmint(payload);
      case 101:
        return decodeAttach(payload);
      case 102:
        return decodeDetach(payload);
      case 110:
        return decodeDestroy(payload);
      default:
        // Unknown message types - return raw hex
        return {
          raw: payload.toString('hex'),
        };
    }
  } catch (error) {
    // If decoding fails, return raw hex
    return {
      raw: payload.toString('hex'),
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

