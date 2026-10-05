# Object Tracking: qué revisar antes de entrenar otra vez

Estado: auditoría del 2026-10-02, actualizada el 2026-10-03; referencia nueva comprobada, reconocimiento físico sin validar y ADR de AR pendiente de aceptación.

Investigación del **2 de octubre de 2026**.
El usuario informa que la prueba sobre el motor real falló.
Sin los estados de esa prueba, no sabemos si faltó detección, seguimiento o visualización.
Terminar el entrenamiento no demuestra reconocimiento real.

## Entrada y salida

```text
USDZ fiel al vano fijo → Create ML → .referenceobject
                                          ↓
cámara del iPhone → ARKit → objeto reconocido + posición/orientación 3D
                                          ↓
                                overlay sobre sus piezas
```

La referencia corresponde a ese objeto concreto.
No aprende automáticamente nombres ni funciones de sus piezas.
[Flujo de Apple](https://developer.apple.com/videos/play/wwdc2024/10101/).

## Versión: macOS también importa

**Documentado:** Apple distingue referencias entrenadas con **macOS 27 y Xcode 27**, que requieren iOS/visionOS 27.
[Compatibilidad](https://developer.apple.com/documentation/visionos/implementing-object-tracking-in-your-app).

Apple recomienda reentrenar con Create ML reciente para mejorar precisión y latencia; las referencias anteriores siguen compatibles.
**Inferencia:** nuestro entrenamiento en macOS 26.7 no demuestra haber usado todas las mejoras.
Actualizar no modifica la referencia existente ni garantiza reconocer el motor.
[Cambios](https://developer.apple.com/documentation/visionos/exploring_object_tracking_with_arkit).

## Qué hacer en Create ML

1. Comprobar **macOS 27 + Xcode 27**.
  Abrir Create ML desde Xcode.
  **New Project → Object Tracking**; guardar proyecto nuevo y arrastrar `aligned.cleaned.usdz`.
2. **Antes de Train:** comparar texturas, geometría y medidas del visor con dimensiones reales verificadas.
  Corregir el USDZ si difieren.
  [Preparación](https://developer.apple.com/documentation/visionos/implementing-object-tracking-in-your-app).
3. **Orientación:** comprobar flechas **Up/Front** y suelo.
  El vano debe quedar en su posición física; corregirlo en Reality Composer Pro antes de entrenar.
  [Demostración](https://developer.apple.com/videos/play/wwdc2024/10101/?time=568).
4. **Viewing angles:** recomendación: **Upright**, con Up verificado; excluye vistas inferiores.
  **Front** también excluye traseras: comprobar la flecha Front antes de elegirlo.
  **All Angles** permite todas las caras.
  [Ángulos](https://developer.apple.com/videos/play/wwdc2024/10101/?time=568).
5. **Training mode:** empezar con **Standard**.
  **Extended** ofrece más precisión, más coste por frame y entrenamiento varias veces más largo; no reemplaza la revisión del USDZ.
  [Comparación](https://developer.apple.com/documentation/visionos/exploring_object_tracking_with_arkit).
6. **Objects to avoid:** USDZ de objetos similares cuando hay falsos positivos.
  **Train → Output → guardar `.referenceobject`**.
  [Exportación](https://developer.apple.com/documentation/visionos/implementing-object-tracking-in-your-app).

**Captura:** representar el conjunto rígido; excluir capó articulado y fondo.
Revisar reflejos, huecos y texturas borrosas.
[Criterios](https://developer.apple.com/videos/play/wwdc2024/10101/).

Si se corrige escala u orientación del USDZ, actualizar también la transformación hacia nuestros landmarks antes de comprobar el overlay.
Entrenar el USDZ corregido no actualiza esa calibración automáticamente.

## Cómo verificar que funciona

**Documentado:** `ARReferenceObject(archiveURL:)` → `detectionObjects` → `didAdd(ARObjectAnchor)` → `isTracked`.
`trackingObjects` corresponde a objetos móviles; mover el teléfono no lo exige.
[Integración iOS](https://developer.apple.com/documentation/visionos/using-a-reference-object-with-arkit-in-ios).

**Prueba:** motor real; registrar estados y tiempo de detección, cambiar ángulos/distancias, verificar overlay, salir/volver al encuadre y probar sin motor.
Una foto en pantalla no valida el volumen real.

## Auditoría del primer entrenamiento (macOS 26.7)

| Comprobado en nuestros archivos | Consecuencia |
|---|---|
| Referencia: `metadata.json` registra macOS **26.7**; entrenamiento Standard/Upright | No certifica haber usado todas las mejoras del entrenamiento de macOS 27 |
| `aligned.cleaned.usdz`: límites **2,155 × 0,983 × 1,282 m**, con escala basada en batería aproximada de 24,2 cm | Verificar dimensiones físicas antes de repetir |
| Rotación de Up durante registro: **0,042°**; pack nivelado con acelerómetro de las fotos | No hay evidencia de haber invertido el modelo; revisar Up en el visor igualmente |
| Hash del USDZ y copia dentro del `.referenceobject` coinciden; CRC válido | Se entrenó el archivo previsto; esto no mide reconocimiento |
| App carga `ARReferenceObject(archiveURL:)` y usa `detectionObjects` | Coincide con la configuración de Apple para objetos quietos |
| Última prueba real: fallo informado por el usuario, sin captura de estados | Falta distinguir detección, seguimiento y dibujo |

La tabla anterior conserva el resumen compartible de los artefactos locales del autor, excluidos de git: `training-standard.source.json`, `training-standard.summary.txt`, `aligned.candidate.prepared.json` y `aligned.cleaned.cleaned.json` bajo `data/ar-reference/gol-trend-engine-bay/`, más `data/pack/gol-trend-engine-bay/1.report.json`.
La [integración ARKit](../../packages/react-native-splat/ios/ARGuideNativeView.swift) sí está en el repositorio.

Comando: `xcrun createml objecttracker --source aligned.cleaned.usdz --output engine-bay.referenceobject --checkpoint training-standard.checkpoint --training-mode standard --upright`, más progreso/resumen.
Terminó con `exitCode=0` en 4 h 26 min.
Sus cuatro losses sin etiquetas no expresan porcentaje de acierto.

Captura positiva con iPhone conectado y motor delante: `uv run pipeline/watch_ar.py --device DEVICE_ID --output .work/ar-check/ar-live.jsonl --duration 60 --expect detected`.
Abre la app: entrar a AR y encuadrar el vano.
Exige frames sin errores y una muestra con objeto seguido; verificar alineación aparte.
El HUD offline no conserva historial.
Sin captura de la última prueba física, la causa sigue sin confirmar.

## Nuevo modelo, 3 de octubre

El usuario completó `GolTrendMotor.mlproj` en macOS **27.0.1**.
Su resultado es formato **2.0**, Standard/**Front**, 47.047.755 bytes; incluye el mismo USDZ, con idénticos límites.
El modelo anterior quedó en `engine-bay-macos26.7-upright.referenceobject`; el nuevo ocupa el nombre que usa la app.
Se verificaron CRC, carga de ambas redes en Core ML y hash del modelo empaquetado.
La app existente se volvió a firmar con esa referencia y número de build **2**.
Estado e instalación: `data/ar-reference/gol-trend-engine-bay/engine-bay.current.json`, artefacto local del autor excluido de git.
El reconocimiento físico del nuevo modelo sigue sin validar.
