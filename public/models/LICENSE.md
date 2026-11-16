# Models

## face_landmarker.task

- Source: https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task
- SHA-256: `64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff`
- Contents: face detector, 478-point face landmark model (with iris refinement),
  geometry pipeline metadata and blendshape model.
- Author: Google (MediaPipe)
- Licence: Apache License 2.0. The full text is in `LICENSE-APACHE-2.0.txt` in this
  folder (also at https://www.apache.org/licenses/LICENSE-2.0). The file is
  redistributed unmodified.
- Model card: https://storage.googleapis.com/mediapipe-assets/MediaPipe%20BlazeFace%20Model%20Card%20(Short%20Range).pdf
  and https://drive.google.com/file/d/1QvwWNfFoweGVjsXF3DXzcrCnz-mx-Lha/preview

The model is served from this folder at runtime; nothing is fetched from a CDN.
The MediaPipe WebAssembly runtime (`@mediapipe/tasks-vision`, Apache-2.0) is
bundled from `node_modules` by Vite.
