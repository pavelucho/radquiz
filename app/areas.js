// RadQuiz — áreas de cada segmento: la lista cerrada con la que se clasifica cada caso.
//
// Un caso lleva una o más parejas segmento → área («clasificacion» en paquete.json), así que puede estar en
// varios segmentos a la vez: una displasia de cadera es musculoesquelético y pediatría. La primera pareja es
// la principal. Un segmento sin áreas admite casos igual, sin área.
//
// Para agregar un área basta una línea «"id": "Nombre"» en su segmento. El id va en minúsculas, sin tildes y
// con guiones, y no se cambia ni se borra mientras algún caso lo use: tools/validar lo marcaría como error.
//
// Lo que sigue a «AREAS =» tiene que ser JSON estricto (comillas dobles, sin comas al final ni comentarios
// dentro), porque tools/validar lee este mismo archivo.
export const AREAS = {
  "neurorradiologia": {
    "anatomia": "Anatomía normal y variantes",
    "ictus": "Ictus, isquemia y trombosis venosa",
    "hemorragia-vascular": "Hemorragia, aneurismas y malformaciones vasculares",
    "tumores": "Tumores cerebrales",
    "selar": "Región selar e hipófisis",
    "infeccion-inflamacion": "Infección e inflamación",
    "sustancia-blanca": "Sustancia blanca y enfermedades desmielinizantes",
    "degenerativas": "Neurodegenerativas y demencias",
    "toxico-metabolicas": "Tóxico-metabólicas",
    "trauma": "Trauma craneoencefálico",
    "hidrocefalia": "Hidrocefalia y trastornos del LCR",
    "congenitas": "Malformaciones congénitas y del desarrollo",
    "epilepsia": "Epilepsia",
    "columna": "Columna y médula espinal"
  },
  "cabeza-cuello": {
    "orbita": "Órbita",
    "senos-paranasales": "Senos paranasales y cavidad nasal",
    "hueso-temporal": "Hueso temporal y oído",
    "base-craneo": "Base de cráneo y pares craneales",
    "faringe-cavidad-oral": "Faringe y cavidad oral",
    "laringe": "Laringe",
    "espacios-cuello": "Espacios profundos del cuello",
    "glandulas-salivales": "Glándulas salivales",
    "tiroides-paratiroides": "Tiroides y paratiroides",
    "ganglios": "Ganglios linfáticos",
    "congenitas": "Lesiones congénitas del cuello",
    "maxilofacial": "Mandíbula, maxilar y dientes",
    "atm": "Articulación temporomandibular"
  },
  "torax": {
    "signos": "Anatomía, signos y patrones",
    "nodulo-cancer": "Nódulo pulmonar y cáncer de pulmón",
    "intersticial": "Enfermedad pulmonar intersticial",
    "infeccion": "Infección pulmonar",
    "via-aerea": "Vía aérea y enfisema",
    "espacio-aereo": "Ocupación alveolar y edema",
    "vascular-pulmonar": "Vascular pulmonar",
    "mediastino": "Mediastino",
    "pleura": "Pleura",
    "pared-diafragma": "Pared torácica y diafragma",
    "trauma": "Trauma torácico",
    "uci": "Paciente crítico y dispositivos"
  },
  "cardiovascular": {},
  "abdomen": {
    "higado": "Hígado",
    "via-biliar": "Vesícula y vía biliar",
    "pancreas": "Páncreas",
    "bazo": "Bazo",
    "esofago-estomago": "Esófago, estómago y duodeno",
    "intestino-delgado": "Intestino delgado",
    "colon-recto": "Colon, recto y ano",
    "peritoneo": "Peritoneo, mesenterio y retroperitoneo",
    "pared-hernias": "Pared abdominal y hernias",
    "abdomen-agudo": "Abdomen agudo",
    "trauma": "Trauma abdominal"
  },
  "genitourinario": {
    "rinon": "Riñón",
    "suprarrenales": "Glándulas suprarrenales",
    "via-urinaria": "Uréteres, vejiga y uretra",
    "prostata": "Próstata y vesículas seminales",
    "escroto": "Escroto y testículo",
    "utero": "Útero y cuello uterino",
    "ovarios-anexos": "Ovarios y anexos",
    "obstetricia": "Obstetricia y placenta",
    "suelo-pelvico": "Suelo pélvico"
  },
  "musculoesqueletico": {
    "hombro": "Hombro",
    "codo": "Codo",
    "muneca-mano": "Muñeca y mano",
    "cadera-pelvis": "Cadera y pelvis",
    "rodilla": "Rodilla",
    "tobillo-pie": "Tobillo y pie",
    "columna": "Columna vertebral",
    "tumores": "Tumores óseos y de partes blandas",
    "artropatias": "Artropatías",
    "infeccion": "Infección osteoarticular",
    "metabolicas": "Enfermedades metabólicas del hueso",
    "medula-osea": "Médula ósea y osteonecrosis",
    "partes-blandas": "Músculo y partes blandas"
  },
  "mama": {},
  "pediatria": {},
  "intervencionismo": {},
  "fisica-tecnica": {}
};
