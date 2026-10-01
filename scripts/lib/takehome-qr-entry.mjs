// Bundle only the locked QR encoder, not the scanner or browser adapters.
import QRCodeWriter from '@zxing/library/esm/core/qrcode/QRCodeWriter.js'
import BarcodeFormat from '@zxing/library/esm/core/BarcodeFormat.js'
import EncodeHintType from '@zxing/library/esm/core/EncodeHintType.js'

export function encodeListingQr(value) {
  const hints = new Map([[EncodeHintType.ERROR_CORRECTION, 'M'], [EncodeHintType.MARGIN, 4], [EncodeHintType.CHARACTER_SET, 'UTF-8']])
  const matrix = new QRCodeWriter().encode(value, BarcodeFormat.QR_CODE, 0, 0, hints)
  const size = matrix.getWidth()
  return { size, modules:Array.from({ length:size }, (_, y) => Array.from({ length:size }, (_, x) => matrix.get(x, y))) }
}
