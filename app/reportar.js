// RadQuiz — reportar un error en un caso. Carga Firebase solo cuando alguien lo usa,
// para no pesar en la práctica normal. El reporte llega al estudio y pone ese caso al
// principio de la cola de verificación.
const SDK = "https://www.gstatic.com/firebasejs/12.19.0";

export async function reportar(tema, casoId, boton) {
  const texto = (prompt("¿Qué está mal en este caso? Lo verá un radiólogo.") || "").trim();
  if (!texto) return;
  if (texto.length < 5) return alert("Escribe un poco más para que se entienda.");
  const original = boton.textContent;
  boton.disabled = true;
  boton.textContent = "Enviando…";
  try {
    const [{ initializeApp, getApps }, { getAuth, signInAnonymously }, base, { firebaseConfig, APP_ANONIMA }] = await Promise.all([
      import(`${SDK}/firebase-app.js`),
      import(`${SDK}/firebase-auth.js`),
      import(`${SDK}/firebase-database.js`),
      import("./firebase-config.js"),
    ]);
    // La misma instancia anónima que la sala, nunca la del estudio: así reportar no toca la sesión de Google.
    const app = getApps().find((a) => a.name === APP_ANONIMA) || initializeApp(firebaseConfig, APP_ANONIMA);
    const auth = getAuth(app);
    await auth.authStateReady();
    if (!auth.currentUser) await signInAnonymously(auth);
    const temaId = String(tema).split("/").pop();
    await base.set(base.ref(base.getDatabase(app), `reportes/${temaId}/${casoId}/${auth.currentUser.uid}`), {
      texto: texto.slice(0, 500),
      fecha: base.serverTimestamp(),
    });
    boton.textContent = "Gracias: ya lo verá un radiólogo";
  } catch (e) {
    boton.disabled = false;
    boton.textContent = original;
    alert("No se pudo enviar el reporte: " + (e.code || e.message));
  }
}
