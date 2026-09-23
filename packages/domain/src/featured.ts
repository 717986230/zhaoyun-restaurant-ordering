/**
 * The promotions page's ten designs, as the admin console shows them.
 *
 * Every design renders the same markup (`FeaturedPage` in the guest app) and
 * differs only in its CSS block in `src/styles.css`, under
 * `.featured-page[data-template="…"]`. So a design is data, not code: adding
 * one is an id in `shared/rules.mjs`, an entry here and a CSS block, and
 * `packages/contracts/test/parity.test.ts` fails if the ids drift apart.
 *
 * Each follows a pattern restaurants actually use for promotions and set
 * menus, and none brings a colour of its own: they all stay inside the menu's
 * palette, so the no-gold rule in styles.test.ts holds for every one.
 */
export type FeaturedTemplateId =
  | "gallery" | "spotlight" | "editorial" | "tasting" | "framed"
  | "poster" | "carousel" | "bento" | "minimal" | "monochrome";

export interface FeaturedTemplate {
  id: FeaturedTemplateId;
  names: { zh: string; en: string; de: string };
  hints: { zh: string; en: string; de: string };
}

export const FEATURED_TEMPLATES: FeaturedTemplate[] = [
  { id: "gallery", names: { zh: "画廊", en: "Gallery", de: "Galerie" }, hints: { zh: "大图卡片，名字压在照片上", en: "Large photo cards, the name set on the photo", de: "Große Fotokarten, Name auf dem Foto" } },
  { id: "spotlight", names: { zh: "主推", en: "Spotlight", de: "Rampenlicht" }, hints: { zh: "第一道整幅大图，其余两列", en: "The first dish full width, the rest in two columns", de: "Das erste Gericht groß, der Rest zweispaltig" } },
  { id: "editorial", names: { zh: "杂志", en: "Editorial", de: "Magazin" }, hints: { zh: "图文左右交错，像美食杂志", en: "Photo and text alternating, like a food magazine", de: "Bild und Text im Wechsel, wie ein Magazin" } },
  { id: "tasting", names: { zh: "品鉴单", en: "Tasting menu", de: "Degustation" }, hints: { zh: "不放图，居中衬线字，像高级餐厅的品鉴菜单", en: "No photos, centred serif courses, like fine dining", de: "Ohne Fotos, zentrierte Gänge wie im Fine Dining" } },
  { id: "framed", names: { zh: "菜单卡", en: "Menu card", de: "Menükarte" }, hints: { zh: "双线边框的卡片，适合套餐", en: "Double-ruled cards, made for set menus", de: "Doppelt gerahmte Karten, ideal für Menüs" } },
  { id: "poster", names: { zh: "海报", en: "Poster", de: "Plakat" }, hints: { zh: "一道菜一整屏，大图大字", en: "One dish per screen, big photo and type", de: "Ein Gericht pro Bildschirm, groß und plakativ" } },
  { id: "carousel", names: { zh: "滑动卡片", en: "Carousel", de: "Karussell" }, hints: { zh: "左右滑动浏览，一次看一道", en: "Swipe sideways, one dish at a time", de: "Seitlich wischen, ein Gericht nach dem anderen" } },
  { id: "bento", names: { zh: "格子拼图", en: "Bento", de: "Bento" }, hints: { zh: "大小格子拼在一起，一眼看全", en: "Tiles of different sizes, everything at a glance", de: "Kacheln verschiedener Größe, alles auf einen Blick" } },
  { id: "minimal", names: { zh: "极简", en: "Minimal", de: "Minimal" }, hints: { zh: "圆形小图加点线价格，干净利落", en: "Round thumbnails and dotted prices, clean", de: "Runde Bilder und gepunktete Preise, schlicht" } },
  { id: "monochrome", names: { zh: "黑白", en: "Monochrome", de: "Schwarzweiß" }, hints: { zh: "黑白照片、强对比，按下显色", en: "Black-and-white photos, colour on touch", de: "Schwarzweiß, Farbe beim Antippen" } }
];

export const FEATURED_TEMPLATE_IDS: FeaturedTemplateId[] = FEATURED_TEMPLATES.map((template) => template.id);
export const DEFAULT_FEATURED_TEMPLATE: FeaturedTemplateId = "gallery";
