# Sincronizacion multidispositivo con Firebase

## 1. Crear Firebase

1. Entra a Firebase Console.
2. Crea un proyecto.
3. Agrega una aplicacion Web.
4. Copia el objeto `firebaseConfig`.
5. Activa Realtime Database.
6. Para pruebas iniciales usa reglas temporales:

```json
{
  "rules": {
    ".read": true,
    ".write": true
  }
}
```

Estas reglas son publicas y solo deben usarse para pruebas.

## 2. Pegar credenciales

Abre `config.js` y reemplaza:

```js
window.FIREBASE_CONFIG = {
  apiKey: "TU_API_KEY",
  authDomain: "TU_PROYECTO.firebaseapp.com",
  databaseURL: "https://TU_PROYECTO-default-rtdb.firebaseio.com",
  projectId: "TU_PROYECTO",
  storageBucket: "TU_PROYECTO.appspot.com",
  messagingSenderId: "TU_MESSAGING_SENDER_ID",
  appId: "TU_APP_ID"
};
```

por los datos reales de tu proyecto Firebase.

## 3. Subir a GitHub Pages

Sube todos los archivos del proyecto, incluyendo:

- `index.html`
- `teorico.html`
- `panel.html`
- `app.js`
- `teorico.js`
- `panel.js`
- `firebase-sync.js`
- `config.js`
- `style.css`
- carpeta `assets/`

## 4. Prueba en dos dispositivos

1. Abre el mismo link publicado en la MacBook.
2. Abre el mismo link en el iPhone.
3. Entra al `Panel comparativo`.
4. Presiona `Probar actualización Firebase`.
5. Ambos dispositivos deben actualizar los datos sin recargar.

## 5. Estructura usada en Realtime Database

```text
monitoreoDumper/
  datosActuales/
  historial/
  videoRooms/
    DUMPER01/
      offer
      answer
      candidatesPhone
      candidatesMac
```

El monitoreo escribe datos actuales y guarda historial solo cuando el dumper fue detectado y presenta movimiento valido.

## 6. Usar iPhone como camara remota

Este metodo es mas confiable que Camara de continuidad cuando el HTML esta publicado.

1. Verifica que `config.js` tenga tu `firebaseConfig` real.
2. Sube tambien `webrtc-camera.js` a GitHub Pages.
3. Abre el mismo link en el iPhone y en la Mac.
4. En ambos dispositivos usa la misma sala, por ejemplo `DUMPER01`.
5. En el iPhone presiona `iPhone: transmitir camara`.
6. Acepta el permiso de camara.
7. En la Mac presiona `Mac: ver camara iPhone`.
8. La Mac recibira el video del iPhone y el monitoreo analizara ese video.

Importante: el iPhone debe mantener la pagina abierta. Por seguridad, la Mac no puede encender la camara del iPhone si el iPhone no abre la pagina y acepta permisos.
