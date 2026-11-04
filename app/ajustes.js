// RadQuiz — ajustes plegables de la cabecera en el celular (práctica y lectura). Los controles (cuáles, modo, cuántos
// casos, solo verificados) ocupaban tres filas encima de cada caso: quedan detrás de un botón que dice cómo están. En
// la computadora no cambia nada: el botón solo se ve en pantallas angostas (app/estilos.css, «ajustes plegables»).
//
// Devuelve la función que vuelve a escribir el resumen, para cuando la página cambia un control por su cuenta (una
// tanda retomada, el número de casos que de verdad salió).
import { esc } from "./comun.js";

export function plegarAjustes(caja = document.querySelector(".herramientas.compacta")) {
  if (!caja) return () => {};
  if (!caja.id) caja.id = "herramientas";
  const boton = document.createElement("button");
  boton.type = "button";
  boton.className = "ajustes-boton";
  boton.setAttribute("aria-expanded", "false");
  boton.setAttribute("aria-controls", caja.id);
  const salto = caja.querySelector(".salto");
  if (salto) salto.after(boton); else caja.prepend(boton);

  // El primer desplegable siempre (de dónde sale la tanda); los demás, solo si no están en lo de siempre.
  const resumir = () => {
    const partes = [];
    for (const fila of caja.querySelectorAll(":scope > label")) {
      if (fila.hidden) continue;
      const lista = fila.querySelector("select");
      const numero = fila.querySelector("input[type=number]");
      const casilla = fila.querySelector("input[type=checkbox]");
      if (lista && lista.selectedIndex >= 0) {
        if (lista.selectedIndex > 0 || !partes.length) partes.push(lista.options[lista.selectedIndex].text);
      } else if (numero && numero.value && !numero.disabled) {
        partes.push(`${numero.value} ${numero.value === "1" ? "caso" : "casos"}`);
      } else if (casilla?.checked) {
        partes.push(fila.textContent.trim());
      }
    }
    boton.innerHTML = `<span><b>Ajustes</b>${partes.length ? ` · ${esc(partes.join(" · "))}` : ""}</span>`;
  };
  boton.onclick = () => {
    const abierta = caja.classList.toggle("abierta");
    boton.setAttribute("aria-expanded", String(abierta));
  };
  caja.addEventListener("change", resumir);
  caja.addEventListener("input", resumir);
  resumir();
  return resumir;
}
