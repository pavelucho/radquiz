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
    const [{ initializeApp, getApps }, { getAuth, signInAnonymously }, base, { firebaseConfig }] = await Promise.all([
      import(`${SDK}/firebase-app.js`),
      import(`${SDK}/firebase-auth.js`),
      import(`${SDK}/firebase-database.js`),
      import("./firebase-config.js"),
    ]);
    const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
    const auth = getAuth(app);
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
