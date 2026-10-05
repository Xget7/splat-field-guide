# Qué opción conviene para el resaltado AR de este repo

Estado: comparación y propuesta del 2026-10-01, sin benchmark físico; la integración de cuatro puntos en ARView está en [08](08-engine-object-registration.md) y el render de máscaras sigue sin decidirse.

## 1. Recomendación

**Usaría ARKit para tracking y nuestro renderer Metal para cámara, máscara y composición.**
Ya tenemos SPZ, etiquetas por splat y un renderer que proyecta, ordena y mezcla sus opacidades.
Esta ruta extiende esas piezas y permite usar imagen y pose del mismo `ARFrame`.

**Alineación automática requerida:** reconocer el vano preparado con una `.referenceobject` entrenada y aplicar `referenceFromPack`.
El flujo completo está en [08: reconocimiento del motor](08-engine-object-registration.md).
Elegir un renderer no resuelve por sí solo ese reconocimiento.

El iPhone tiene iOS 27.
RealityKit con splats nativos merece un experimento pequeño, pero todavía debemos comprobar proyección, límites y equivalencia de la máscara antes de migrar.

**Esto es investigación y una propuesta para máscaras semánticas.
La app ya conecta ARView y cuatro puntos; no hay mediciones comparativas físicas de los renderizadores.**

## 2. Qué tenemos y qué falta

**Disponible:** `cloud.spz`, `labels.bin`, aproximadamente 2,5 millones de splats, selección de piezas, renderer Metal propio y un [USDZ del vano con alineación candidata](08-engine-object-registration.md#qué-existe-ahora).
**Implementado:** limpieza, entrenamiento y sesión AR con cuatro puntos, eventos tipados y reintento de flash según el estado real.
**Pendiente:** validar escala/calibración y reconocimiento físico, máscara semántica y composición sobre video.
No hay USDZ separado por pieza.

| Opción | Qué agrega | Qué exige en nuestro caso | Decisión |
|---|---|---|---|
| **ARKit + Metal existente** | Tracking, video y máscara controlados por nosotros | Extender cámara y rasterizado actuales | Propuesta semántica |
| ARView + postProcess | RealityKit presenta cámara; compute shader colorea máscara | Generar máscara igualmente y sincronizarla con el frame de ARView | No reduce el trabajo principal |
| ARView + mallas por pieza | Superposición con materiales y entidades | Crear/alinear/separar mallas que hoy no existen | Útil para demo aproximada |
| RealityRenderer + splats nativos | RealityKit proyecta y mezcla splats en un target offscreen | Adaptar buffers, probar cámara y máscara semántica | Experimento posterior |

Esta decisión es nuestra evaluación técnica según los assets y código existentes, no un benchmark entre frameworks.

## 3. Pipeline recomendado, con APIs concretas

### A. Preparación offline

1. Reutilizar SAM → `lift_all.py` → `export.py` para obtener SPZ y etiquetas.
2. Medir el motor y preparar landmarks métricos.
3. Obtener un USDZ fiel al vano, registrarlo con el pack y guardar `referenceFromPack`; entrenar su `.referenceobject` con Create ML.
  [Pasos concretos](08-engine-object-registration.md#pipeline-propuesto).
4. Incluir SPZ/labels en la compilación con `scripts/prepare.sh`; preparar e incluir aparte la referencia entrenada y su registro candidato.

### B. Arranque del iPhone

Crear `ARSession` + `ARWorldTrackingConfiguration`.
Cargar `ARReferenceObject(archiveURL: localReferenceURL)`, asignar `detectionObjects = [reference]` para el conjunto estacionario y `session.viewLayer = metalView.layer`.

Cuando un `ARObjectAnchor` de esa referencia está tracked, calcular `worldFromPack = objectAnchor.transform * referenceFromPack`.
Usar el anchor presente en cada frame y mostrar resaltado solo mientras el objeto esté localizado y la cámara tenga tracking válido.
Después de resetear la sesión, volver a reconocer el conjunto reutilizando el registro.
[Objetos de referencia en iOS](https://developer.apple.com/documentation/visionos/using-a-reference-object-with-arkit-in-ios).

### C. Cada frame, nativamente

```swift
guard let frame = session.currentFrame,
      let angle = session.viewRotationAngle else { return }
let viewFromPack = frame.camera.viewMatrix(viewRotationAngle: angle)
                 * worldFromPack
let projection = frame.camera.projectionMatrix(
    viewRotationAngle: angle, viewportSize: drawablePixelSize,
    zNear: 0.05, zFar: 20
)
```

`worldFromPack` viene del anchor presente en ese mismo frame.
También tomar `frame.capturedImage`: convertir sus planos Y/CbCr a texturas con `CVMetalTextureCacheCreateTextureFromImage()`.
Usar `frame.displayTransform(...).inverted()` para orientar sus UV.
**Una captura alimenta imagen y geometría.**
[ARKit con Metal](https://developer.apple.com/documentation/arkit/displaying-an-ar-experience-with-metal).

### D. Dos trabajos de GPU

**Primero, generar máscara:** reutilizar proyección, sorting y rasterizado.
Dibujar todos los splats para conservar oclusores; el fragment devuelve:

```metal
return float4(isSelected ? alpha : 0, 0, 0, alpha);
```

Con el blending front-to-back existente, R acumula cobertura visible de la pieza y A cobertura total.
**Después, componer:** `finalRGB = mix(cameraRGB, tintRGB, mask.r * opacity)`.
Agregar contorno o pulso solo después de comprobar el encaje.

**Salida:** video con la pieza coloreada.
Todo usa assets locales.
Las modificaciones concretas de engine/cámara/GPU están en [B.7–B.9 del pipeline](06-ar-offline-segmentation.md#7-preparar-cada-frame-para-metal).

## 4. Por qué ARView + shader no resuelve todo

`ARView.renderCallbacks.postProcess` permite procesar la imagen con GPU.
El contexto entrega texturas source/target, command buffer, `projection` y tiempo de escena.
**No entrega `ARFrame`, matriz de vista ni timestamp de cámara.**
`ARView.cameraTransform` existe por separado, pero las APIs consultadas no documentan correspondencia exacta con ese callback.
Usar la captura más reciente podría introducir desfase: habría que validarlo.
[PostProcessContext](https://developer.apple.com/documentation/realitykit/arview/postprocesscontext), [cameraTransform](https://developer.apple.com/documentation/realitykit/arview/cameratransform).

Además, alguien debe generar la máscara desde nuestros splats.
Podemos integrarlo, pero mantenemos el renderer y sumamos la coordinación con RealityKit.
Por eso no lo elegiría como primer camino.

`CustomMaterial.SurfaceShader` actúa sobre superficies de entidades con malla; postProcess actúa sobre pantalla.
Para una alternativa con mallas: producir USDZ desde CAD/Object Capture, alinearlo a los landmarks del pack, separar piezas preservando coordenadas y cargarlas mediante `Entity.load(contentsOf:)`.
Colorear con `UnlitMaterial` + `.transparent(opacity: .init(floatLiteral: 0.45))`; usar `OcclusionMaterial()` en el resto.
**Es un resaltado de malla, cuya fidelidad depende de esa malla.**
[SurfaceShader](https://developer.apple.com/documentation/realitykit/custommaterial/surfaceshader), [Carga USDZ](https://developer.apple.com/documentation/realitykit/loading-entities-from-a-file), [UnlitMaterial](https://developer.apple.com/documentation/realitykit/unlitmaterial), [OcclusionMaterial](https://developer.apple.com/documentation/realitykit/occlusionmaterial).

## 5. La alternativa nativa que sí probaría

iOS 27 ofrece `GaussianSplatResource` + `GaussianSplatComponent`.
Requiere GPU Apple7, buffers preparados por nosotros y respeta un límite interno de cantidad, sin cifra publicada.
No expone shaders del rasterizador ni un campo de labels.
[GaussianSplatComponent](https://developer.apple.com/documentation/realitykit/gaussiansplatcomponent).

**Eso no impide generar una máscara:** propuesta a comprobar, alimentar SH de grado cero con rojo para la pieza y negro para el resto, conservando opacidades.
Los buffers se pueden modificar.
Crear un target offscreen así y componer su canal rojo sobre la cámara:

```swift
let output = try RealityRenderer.CameraOutput(
    .singleProjection(colorTexture: maskTexture)
)
```

`singleProjection` pertenece al descriptor que recibe ese initializer.
[GaussianSplatResource](https://developer.apple.com/documentation/realitykit/gaussiansplatresource), [CameraOutput](https://developer.apple.com/documentation/realitykit/realityrenderer/cameraoutput).

El experimento debe probar: aceptación de nuestro count, colores sin tone mapping, oclusión entre piezas y coincidencia con la cámara AR.
`ProjectiveTransformCameraComponent` documenta proyecciones simétricas y reverse-Z; hay que verificar adaptación de intrinsics, principal point y orientación.
**No está demostrada todavía la equivalencia con nuestra cámara/render.**
[Cámara proyectiva](https://developer.apple.com/documentation/realitykit/projectivetransformcameracomponent).

## 6. Primer resultado que buscaría

Reconocimiento automático → pins en cuatro landmarks → máscara de una pieza → varios ángulos → arranque en modo avión.
Medir reconocimiento, encaje, deriva, desfase y tiempo GPU.
El marcador puede ayudar a diagnosticar el render durante desarrollo.
La oclusión de manos queda para después: requiere profundidad compatible; LiDAR no elimina errores en bordes finos o superficies reflectantes.

**Los riesgos principales siguen siendo etiquetas correctas, escala y registro precisos, y rendimiento con el pack real.
Cambiar de framework no resuelve esas tres verificaciones.**
