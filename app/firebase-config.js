// Configuración web de Firebase. Es pública por diseño: la seguridad está en database.rules.json.
export const firebaseConfig = {
  apiKey: "AIzaSyCloc9LskjXn3wLG01CMS4S5-WQLrgzJNo",
  authDomain: "radquiz-shpn2.firebaseapp.com",
  databaseURL: "https://radquiz-shpn2-default-rtdb.firebaseio.com",
  projectId: "radquiz-shpn2",
  appId: "1:1096349700961:web:8667880b8b15e55551eb20",
};

// Clave con la que la web pide a Google Drive las figuras publicadas, que son archivos compartidos con
// «cualquiera con el enlace». Es la misma clave pública: en la consola de Google Cloud tiene que tener
// permitida la API de Google Drive, además de las de Firebase.
export const claveDrive = firebaseConfig.apiKey;

// Instancia de Firebase para las sesiones anónimas (sala en vivo y reportes). Va aparte de la instancia
// por defecto, que es la del estudio con Google: así ninguna cierra la sesión de la otra.
export const APP_ANONIMA = "anonimo";
