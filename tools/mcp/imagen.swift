// RadQuiz — ayudante de imágenes del servidor MCP (solo macOS: usa Vision y CoreGraphics, sin dependencias).
//
//   imagen ocr <figura.jpg>                        texto que hay en la figura, con su caja en píxeles
//   imagen tapar <entrada.jpg> <salida.jpg> x0,y0,x1,y1 [...]   pinta de blanco esos rectángulos
//   imagen preparar <entrada> <salida.jpg>         lado mayor ≤ 1600 px y ≤ 250 KB, como el estudio
//
// Todo sale en JSON por la salida estándar. «tapar» y «preparar» guardan JPEG por debajo de 245 000 bytes
// (el validador pide ≤ 250 KB): bajan la calidad de 0,92 en 0,04 hasta 0,6 y, si no alcanza, reducen el tamaño.
import AppKit
import Foundation
import ImageIO
import UniformTypeIdentifiers
import Vision

let LIMITE = 245_000
let LADO_MAX = 1600

func salir(_ mensaje: String) -> Never {
  FileHandle.standardError.write((mensaje + "\n").data(using: .utf8)!)
  exit(1)
}

func json(_ valor: Any) {
  let datos = try! JSONSerialization.data(withJSONObject: valor, options: [.sortedKeys])
  print(String(data: datos, encoding: .utf8)!)
}

func cargar(_ ruta: String) -> CGImage {
  guard let fuente = CGImageSourceCreateWithURL(URL(fileURLWithPath: ruta) as CFURL, nil),
        let imagen = CGImageSourceCreateImageAtIndex(fuente, 0, nil) else { salir("No pude abrir \(ruta)") }
  return imagen
}

func lienzo(_ ancho: Int, _ alto: Int) -> CGContext {
  guard let ctx = CGContext(data: nil, width: ancho, height: alto, bitsPerComponent: 8, bytesPerRow: 0,
                            space: CGColorSpaceCreateDeviceRGB(),
                            bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue) else { salir("Sin memoria para el lienzo") }
  ctx.interpolationQuality = .high
  return ctx
}

func jpeg(_ imagen: CGImage, _ calidad: Double) -> Data {
  let datos = NSMutableData()
  guard let destino = CGImageDestinationCreateWithData(datos, UTType.jpeg.identifier as CFString, 1, nil) else {
    salir("No pude crear el JPEG")
  }
  CGImageDestinationAddImage(destino, imagen, [kCGImageDestinationLossyCompressionQuality: calidad] as CFDictionary)
  CGImageDestinationFinalize(destino)
  return datos as Data
}

// Re-dibuja a escala y guarda por debajo del límite. Devuelve lo que hizo.
func guardar(_ original: CGImage, _ ruta: String, escalaInicial: Double) -> [String: Any] {
  var escala = escalaInicial
  while true {
    let ancho = max(1, Int((Double(original.width) * escala).rounded()))
    let alto = max(1, Int((Double(original.height) * escala).rounded()))
    let ctx = lienzo(ancho, alto)
    ctx.draw(original, in: CGRect(x: 0, y: 0, width: ancho, height: alto))
    let imagen = ctx.makeImage()!
    var calidad = 0.92
    while calidad >= 0.6 - 1e-9 {
      let datos = jpeg(imagen, calidad)
      if datos.count <= LIMITE {
        try! datos.write(to: URL(fileURLWithPath: ruta))
        return ["bytes": datos.count, "calidad": (calidad * 100).rounded() / 100, "ancho": ancho, "alto": alto]
      }
      calidad -= 0.04
    }
    escala *= 0.85
  }
}

let args = CommandLine.arguments
guard args.count >= 3 else { salir("Uso: imagen ocr|tapar|preparar …") }

switch args[1] {
case "ocr":
  let imagen = cargar(args[2])
  let pedido = VNRecognizeTextRequest()
  pedido.recognitionLevel = .accurate
  pedido.usesLanguageCorrection = false
  try? VNImageRequestHandler(cgImage: imagen).perform([pedido])
  let W = Double(imagen.width), H = Double(imagen.height)
  var lineas: [[String: Any]] = []
  for obs in pedido.results ?? [] {
    guard let c = obs.topCandidates(1).first, c.confidence > 0.3 else { continue }
    let b = obs.boundingBox  // normalizada, origen abajo a la izquierda
    lineas.append([
      "texto": c.string,
      "confianza": (Double(c.confidence) * 100).rounded() / 100,
      "caja": [Int((b.minX * W).rounded()), Int(((1 - b.maxY) * H).rounded()),
               Int((b.maxX * W).rounded()), Int(((1 - b.minY) * H).rounded())],
    ])
  }
  json(["ancho": imagen.width, "alto": imagen.height, "lineas": lineas])

case "tapar":
  guard args.count >= 5 else { salir("Uso: imagen tapar <entrada> <salida> x0,y0,x1,y1 …") }
  let imagen = cargar(args[2])
  let W = imagen.width, H = imagen.height
  let ctx = lienzo(W, H)
  ctx.draw(imagen, in: CGRect(x: 0, y: 0, width: W, height: H))
  ctx.setFillColor(CGColor(red: 1, green: 1, blue: 1, alpha: 1))
  for texto in args[4...] {
    let n = texto.split(separator: ",").compactMap { Int($0) }
    guard n.count == 4, n[2] > n[0], n[3] > n[1] else { salir("Rectángulo inválido: \(texto)") }
    let x0 = max(0, n[0]), y0 = max(0, n[1]), x1 = min(W, n[2]), y1 = min(H, n[3])
    ctx.fill(CGRect(x: x0, y: H - y1, width: x1 - x0, height: y1 - y0))  // CoreGraphics cuenta y desde abajo
  }
  json(guardar(ctx.makeImage()!, args[3], escalaInicial: 1))

case "preparar":
  guard args.count >= 4 else { salir("Uso: imagen preparar <entrada> <salida>") }
  let imagen = cargar(args[2])
  let escala = min(1, Double(LADO_MAX) / Double(max(imagen.width, imagen.height)))
  json(guardar(imagen, args[3], escalaInicial: escala))

default:
  salir("Orden desconocida: \(args[1])")
}
