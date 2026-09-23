import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { deconstruct, LANGUAGE_INFO } from "@zhaoyun/domain";
import type { DishPart, FeaturedTemplateId, MenuLanguage, Product } from "@zhaoyun/domain";
import { allergenLabel } from "../../../../../src/allergens.js";
import { restaurantApi } from "../../app/api";
import type { CustomerDispatch, CustomerState } from "../../app/model";
import { assignedTableNo } from "../../app/table";
import { formatPrice, productName, secondaryName, t } from "../../app/i18n";
import type { ColorScheme } from "../../app/useColorScheme";
import { usePageTurn } from "./usePageTurn";
import type { TurnDirection } from "./usePageTurn";

interface Props {
  state: CustomerState;
  dispatch: CustomerDispatch;
  /** What is on the menu right now. */
  products: Product[];
  /** Everything, dishes outside their hours included: a set still names a
   *  dish that is not served on its own at this hour, and a card a guest has
   *  open stays open when its hours end. Defaults to `products`. */
  catalog?: Product[];
  /** The languages the restaurant switched on, in flag order. */
  languages: MenuLanguage[];
  /** The heading the owner set; "La Carte" until they set one. */
  title: string;
  showTableNumber: boolean;
  scheme: ColorScheme;
  onToggleScheme: () => void;
  /** Counts taps on the title; the seventh within four seconds opens the admin console. */
  onAdminTap: () => Promise<void>;
  /** The promotions page, when the owner switched it on and chose dishes. */
  featured: { title: string; products: Product[]; template: FeaturedTemplateId } | null;
}

/** The promotions page's place among the categories; no real category is called this. */
export const FEATURED_PAGE = "__featured__";
/** The set menus' page: every dish that packages others, whatever its category. */
export const SETS_PAGE = "__sets__";

/** A set menu is a dish made of other dishes; nothing else marks one. */
export function isSet(product: Product): boolean {
  return Boolean(product.bundleItems?.length);
}

/**
 * Shared with the `--ease-out` / `--dur-*` tokens in styles.css. The CSS
 * `prefers-reduced-motion` block cannot reach these JS-driven animations, so
 * every duration goes through `useReducedMotion` below instead.
 */
const EASE = [0.2, 0.8, 0.2, 1] as const;
const DURATION = { backdrop: 0.2, card: 0.32, page: 0.46 };
/** The card turns like a card: quick off the mark, settling without a wobble. */
const FLIP_SPRING = { type: "spring", stiffness: 150, damping: 22, mass: 1 } as const;

function localized(names: { zh: string; de: string; en: string }, language: CustomerState["language"]): string {
  return names[language] || names.de || names.en;
}

/**
 * One dish, however it is illustrated.
 *
 * A photo fades in once it has decoded rather than painting in strips, and a
 * photo that cannot load — a tablet offline, a file removed — falls back to the
 * dish's generated artwork, so a row is never an empty grey box.
 */
function ProductMedia({ product, size = "feature" }: { product: Product; size?: "feature" | "thumb" }) {
  const media = product.media[0];
  // Remembered per URL, not per row: the menu first draws from the copy the
  // app ships with and then from the server, and a photo that is replaced
  // gets a new URL — neither may inherit the old one's failure.
  const [loaded, setLoaded] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const art = <div className={`art ${size === "thumb" ? "art-thumb " : ""}${product.appearance.pattern}`} style={{ "--art": product.appearance.art } as React.CSSProperties} />;
  const source = media ? restaurantApi.mediaUrl(media.url) : null;
  if (!media || !source || failed === source) return art;
  const className = `${size === "thumb" ? "dish-media dish-media-thumb" : "dish-media"} ${loaded === source ? "loaded" : ""}`;
  if (media.type === "video") {
    return <video className={`${className} loaded`} src={source} poster={media.posterUrl ? restaurantApi.mediaUrl(media.posterUrl) : undefined} playsInline muted loop autoPlay preload="metadata" onError={() => setFailed(source)} />;
  }
  return <img
    className={className}
    src={source}
    alt={size === "thumb" ? "" : product.names.zh || product.names.de}
    width={size === "thumb" ? 48 : 480}
    height={size === "thumb" ? 48 : 360}
    loading="lazy"
    decoding="async"
    onLoad={() => setLoaded(source)}
    onError={() => setFailed(source)}
  />;
}

/**
 * The restaurant's title, as large as the header allows and never larger.
 *
 * The owner names it, so it can be "La Carte" or "Chiri Kitchen" or longer;
 * a fixed size either wastes the header or runs into the search button and
 * the flags. This measures the space between them and shrinks the type until
 * the name fits, again whenever the screen turns or the name changes.
 */
function FitTitle({ text }: { text: string }) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const title = ref.current;
    const room = title?.parentElement;
    if (!title || !room) return;
    const fit = () => {
      title.style.fontSize = "";
      title.dataset.wrap = "false";
      const available = room.clientWidth;
      const needed = title.scrollWidth;
      if (!available || needed <= available) return;
      const natural = Number.parseFloat(getComputedStyle(title).fontSize);
      const oneLine = Math.floor(natural * (available / needed) * 0.97);
      if (oneLine >= 18) {
        title.style.fontSize = `${oneLine}px`;
        return;
      }
      // Too long for one line at a size anyone can read: two lines instead.
      title.dataset.wrap = "true";
      title.style.fontSize = `${Math.max(15, Math.min(Math.floor(natural * 0.62), Math.floor(natural * ((2 * available) / needed) * 0.85)))}px`;
    };
    fit();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(fit);
    observer?.observe(room);
    void document.fonts?.ready.then(fit);
    return () => observer?.disconnect();
  }, [text]);
  return <strong ref={ref}>{text}</strong>;
}

/** Time, portion and spice level — only those the kitchen filled in. */
function facts(product: Product): string[] {
  return [product.details.time, product.details.people, product.details.level].filter((fact): fact is string => Boolean(fact && fact.trim()));
}

type ProductIndex = Map<string, Product>;

/** A set's dishes, in the order the owner packed them; a dish since removed is skipped. */
function setContents(product: Product, byId: ProductIndex): Array<{ dish: Product; quantity: number }> {
  return (product.bundleItems ?? []).flatMap((item) => {
    const dish = byId.get(item.productId);
    return dish ? [{ dish, quantity: item.quantity }] : [];
  });
}

/**
 * A dish's picture — and for a set, the dishes it is made of, side by side.
 *
 * A set is its contents: one photo of one plate says less about "2× gyoza,
 * bulgogi, mapo tofu, 2× mochi" than the four of them together. So wherever
 * a set is drawn — its row, its detail card, the promotions page — it is the
 * same grid of up to four of its dishes, and a set of fewer than two known
 * dishes falls back to its own picture.
 */
function DishPicture({ product, byId, size = "feature" }: { product: Product; byId: ProductIndex; size?: "feature" | "thumb" }) {
  const dishes = setContents(product, byId).map(({ dish }) => dish);
  if (dishes.length < 2) return <ProductMedia product={product} size={size} />;
  const shown = dishes.slice(0, 4);
  return <div className={`set-collage n${shown.length} ${size === "thumb" ? "set-collage-thumb" : ""}`} aria-label={shown.map((dish) => dish.names.de || dish.names.zh).join(", ")}>
    {shown.map((dish) => <ProductMedia key={dish.id} product={dish} />)}
    {dishes.length > 4 && <span className="set-collage-more">+{dishes.length - 4}</span>}
  </div>;
}

/** What a set holds, one line per dish: its picture, how many, its name. */
function SetList({ product, byId, language }: { product: Product; byId: ProductIndex; language: CustomerState["language"] }) {
  const contents = setContents(product, byId);
  if (!contents.length) return null;
  return <div className="set-list">
    <p className="set-list-heading">{t(language, "bundleIncludes")}</p>
    <ul>{contents.map(({ dish, quantity }) => <li key={dish.id}>
      <span className="set-list-thumb"><ProductMedia product={dish} size="thumb" /></span>
      {quantity > 1 && <b className="set-list-qty">{quantity}×</b>}
      <span className="set-list-name">{productName(dish, language)}</span>
    </li>)}</ul>
  </div>;
}

/** Line icons for the light/dark switch; the ☀ ☾ glyphs look different on every phone. */
function SunIcon() {
  return <svg className="scheme-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4" /><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4" /></svg>;
}

function MoonIcon() {
  return <svg className="scheme-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 14.2A8 8 0 0 1 9.8 4a8 8 0 1 0 10.2 10.2z" /></svg>;
}

/**
 * The dish, taken apart.
 *
 * This is what a guest gets instead of a plate exploding into its ingredients:
 * a flat photo has no alpha channel, so moving a layer off it does not remove
 * it from the picture underneath, and the "3D split" reads as the dish drawn
 * twice. What does work from the data that exists is the dish coming apart
 * into named components, each carrying the allergens it is responsible for —
 * which is also the thing a guest with an allergy actually wants, because
 * `A · C · F` on the whole bowl does not say whether the egg can be left out.
 *
 * The letters here are never new information: `deconstruct` only ever
 * redistributes what the kitchen already declared, and whatever it cannot
 * place stays visible under its own heading rather than disappearing.
 */
function Deconstruction({ product, language, reduceMotion, showing }: { product: Product; language: CustomerState["language"]; reduceMotion: boolean; showing: boolean }) {
  const { parts, portions, unattributed } = useMemo(() => deconstruct(product), [product]);
  const name = (part: DishPart) => (language === "zh" ? part.zh : language === "en" ? part.en : part.de);
  const second = (part: DishPart) => (language === "de" ? part.zh : part.de);

  if (!parts.length && !portions.length && !unattributed.length) return null;
  return <div className="dish-parts-block">
    <p className="parts-heading">{t(language, "parts")}</p>
    <ol className="dish-parts">{parts.map((part, index) => <motion.li className="dish-part" key={`${part.de}-${index}`}
      // The parts come off the dish as the card turns over, not while it
      // is still face up and they cannot be seen.
      initial={reduceMotion ? false : { opacity: 0, y: 14, rotateX: -24 }}
      animate={showing || reduceMotion ? { opacity: 1, y: 0, rotateX: 0 } : { opacity: 0, y: 14, rotateX: -24 }}
      transition={{ delay: reduceMotion || !showing ? 0 : 0.2 + index * 0.045, duration: reduceMotion ? 0 : 0.34, ease: EASE }}>
      <span className="part-index">{String(index + 1).padStart(2, "0")}</span>
      <span className="part-name"><b>{name(part)}</b><small>{second(part)}</small></span>
      {part.allergens.length > 0 && <span className="allergen-list part-allergens">{part.allergens.map((code) => <b className="allergen" key={code} title={allergenLabel(code, language)}>{code}</b>)}</span>}
    </motion.li>)}</ol>
    {portions.length > 0 && <p className="parts-portion">{t(language, "portionOf")} · {portions.map((part) => name(part)).join(" / ")}</p>}
    {/* When nothing could be attributed, this box would just repeat the
        declared list a few lines further down, so it stays closed. */}
    {unattributed.length > 0 && unattributed.length < product.allergens.length && <p className="parts-loose">
      <span>{t(language, "alsoContains")}</span>
      <span className="allergen-list">{unattributed.map((code) => <b className="allergen" key={code}>{code} {allergenLabel(code, language)}</b>)}</span>
    </p>}
  </div>;
}

/**
 * What a guest could ask for, shown rather than offered.
 *
 * These were once a form: pick a radio, tick a box, see the total change. On
 * a menu nobody orders from, an interactive control that does nothing is
 * worse than no control, so this reads the same data — the modifier groups
 * an admin already configured for the (dormant) ordering flow — as plain
 * text. "加面 +2,50" tells a guest what they can ask the waiter for without
 * pretending a tap here does anything.
 */
function DishOptions({ product, language }: { product: Product; language: CustomerState["language"] }) {
  if (!product.modifiers?.length) return null;
  return <div className="dish-options">
    <p className="modifier-heading">{t(language, "customize")}</p>
    {product.modifiers.map((group) => <p className="dish-options-group" key={group.id}>
      <b>{localized(group.names, language)}</b>
      {group.options.map((option) => <span key={option.id}>
        {localized(option.names, language)}{option.priceCents > 0 ? ` +${formatPrice(option.priceCents, language)}` : ""}
      </span>)}
    </p>)}
  </div>;
}

function ProductDetail({ product, byId, state, dispatch }: { product: Product; byId: ProductIndex; state: CustomerState; dispatch: CustomerDispatch }) {
  const reduceMotion = useReducedMotion();
  const seconds = (value: number) => (reduceMotion ? 0 : value);

  return <motion.div id="dishOverlay" className="dish-overlay open" aria-hidden="false"
    initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
    transition={{ duration: seconds(DURATION.backdrop), ease: EASE }}
    onClick={(event) => {
      if (event.target === event.currentTarget) dispatch({ type: "close-product" });
    }}>
    {/* Rises toward the guest, tilted back a few degrees, and settles flat. */}
    <motion.div className="dish-detail-card" data-detail-id={product.id}
      style={{ transformPerspective: 1400 }}
      initial={reduceMotion ? false : { opacity: 0, y: 28, scale: 0.94, rotateX: 9 }}
      animate={{ opacity: 1, y: 0, scale: 1, rotateX: 0 }}
      exit={{ opacity: 0, y: 16, scale: 0.97, rotateX: 4 }}
      transition={{ duration: seconds(DURATION.card), ease: EASE }}>
      <button className="detail-close" aria-label={t(state.language, "close")} onClick={() => dispatch({ type: "close-product" })}>×</button>
      {/* Mid-turn the card dips back a little, the way a card lifted off a
          table does; the rotation itself is a spring, so a second tap while
          it is turning reverses it from where it is instead of jumping. */}
      <motion.div className={`detail-flip-inner ${state.productFlipped ? "flipped" : ""}`}
        initial={false}
        animate={{ rotateY: state.productFlipped ? 180 : 0, scale: reduceMotion ? 1 : [1, 0.86, 1] }}
        transition={reduceMotion ? { duration: 0 } : { rotateY: FLIP_SPRING, scale: { duration: 0.62, times: [0, 0.45, 1], ease: EASE } }}>
        <section className="detail-face detail-front" aria-label={t(state.language, "flip")} onClick={() => dispatch({ type: "toggle-product-flip" })}>
          <div className="detail-heading">
            <span className="number">{product.sku}</span><span className="cat">{product.category}</span>
            <h3>{productName(product, state.language)}</h3>{secondaryName(product, state.language) && <p>{secondaryName(product, state.language)}</p>}
          </div>
          <div className="detail-scroll">
            {/* The photo takes the whole width. The description is on the
                back with the rest of the facts, and so is the photo credit. */}
            <figure className="feature-media"><DishPicture product={product} byId={byId} /></figure>
            <DishOptions product={product} language={state.language} />
            <SetList product={product} byId={byId} language={state.language} />
            {facts(product).length > 0 && <div className="meta">{facts(product).map((fact) => <span key={fact}>{fact}</span>)}</div>}
          </div>
          <div className="detail-buy">
            <div className="buyline"><strong>{formatPrice(product.priceCents, state.language)}</strong></div>
          </div>
        </section>
        <section className="detail-face detail-back" aria-label={t(state.language, "detailRegion")} onClick={() => dispatch({ type: "toggle-product-flip" })}>
          <button className="flip-back" onClick={(event) => { event.stopPropagation(); dispatch({ type: "toggle-product-flip" }); }}>{t(state.language, "back")}</button>
          <div><small>{product.sku} · {t(state.language, "breakdown")}</small><h3>{productName(product, state.language)}</h3><p>{product.description}</p></div>
          <div className="detail-back-scroll" onClick={(event) => event.stopPropagation()}>
            {/* A set is taken apart into its dishes; a dish into its ingredients. */}
            {isSet(product)
              ? <SetList product={product} byId={byId} language={state.language} />
              : <Deconstruction product={product} language={state.language} reduceMotion={Boolean(reduceMotion)} showing={state.productFlipped} />}
            <dl>
              {/* The declared list stays whole and stays first among the facts:
                  it is the legal statement, and the breakdown above only
                  explains it. */}
              <div><dt>{t(state.language, "allergens")}</dt><dd>{product.allergens.length
                ? <span className="allergen-list">{product.allergens.map((code) => <b className="allergen" key={code} title={allergenLabel(code, state.language)}>{code} {allergenLabel(code, state.language)}</b>)}</span>
                : "—"}</dd></div>
              {product.details.time && <div><dt>{t(state.language, "time")}</dt><dd>{product.details.time}</dd></div>}
              {(product.details.people || product.details.level) && <div><dt>{t(state.language, "portion")}</dt><dd>{[product.details.people, product.details.level].filter(Boolean).join(" · ")}</dd></div>}
              {product.media[0]?.credit && <div className="photo-credit-row"><dt>{t(state.language, "photo")}</dt><dd className="photo-credit">{product.media[0].credit}</dd></div>}
            </dl>
          </div>
        </section>
      </motion.div>
    </motion.div>
  </motion.div>;
}

/**
 * The promotions page: set menus and signature dishes, first in the menu and
 * unlike the rest of it.
 *
 * One markup for all ten designs the owner can pick from; each design is a
 * CSS block in styles.css under `.featured-page[data-template="…"]`, so a new
 * design never touches this component. That is why a few things are written
 * twice — the name on the photo and in the text, the price in the caption and
 * in the footer: every design shows the one that suits it and hides the other.
 * Elegance by depth and restraint — a darker room, pearl type, fine lines —
 * and not by gold, which the palette rules out on purpose.
 */
function FeaturedPage({ title, eyebrow, template, products, byId, language, onOpen }: { title: string; eyebrow: string; template: FeaturedTemplateId; products: Product[]; byId: ProductIndex; language: CustomerState["language"]; onOpen: (id: string) => void }) {
  return <div className="featured-page" data-template={template}>
    <header className="featured-hero">
      <p className="featured-eyebrow">✦ {eyebrow} ✦</p>
      <h2>{title}</h2>
      <p className="featured-rule" aria-hidden="true"><i /></p>
    </header>
    <div className="featured-grid">{products.map((product, index) => {
      const number = String(index + 1).padStart(2, "0");
      const name = productName(product, language);
      const second = secondaryName(product, language);
      const price = formatPrice(product.priceCents, language);
      return <article key={product.id} className="featured-card" data-id={product.id} style={{ "--row": Math.min(index, 11) } as React.CSSProperties} role="button" tabIndex={0}
        onClick={() => onOpen(product.id)}
        onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onOpen(product.id); } }}>
        <div className="featured-photo">
          <DishPicture product={product} byId={byId} />
          <div className="featured-caption">
            <span className="featured-number">{number}</span>
            <h3>{name}</h3>
            <span className="featured-caption-price">{price}</span>
          </div>
        </div>
        <div className="featured-body">
          <span className="featured-number featured-body-number">{number}</span>
          <h3 className="featured-name">{name}</h3>
          {second && <p className="featured-second">{second}</p>}
          {product.description && <p className="featured-description">{product.description}</p>}
          <SetList product={product} byId={byId} language={language} />
          <div className="featured-foot">
            <span className="featured-view">{t(language, "featuredView")} →</span>
            <i className="featured-leader" aria-hidden="true" />
            <strong className="featured-price">{price}</strong>
          </div>
        </div>
      </article>;
    })}</div>
  </div>;
}

export function CatalogScreen({ state, dispatch, products, catalog = products, languages, title, showTableNumber, scheme, onToggleScheme, onAdminTap, featured }: Props) {
  const query = state.query.trim().toLowerCase();
  // A search looks through the whole menu, whatever page it was typed on.
  const onFeatured = Boolean(featured) && state.category === FEATURED_PAGE && !query;
  // Set menus have a page of their own and stay out of "all" and the
  // categories, so a guest looking for a dish does not wade through bundles.
  const byId = useMemo<ProductIndex>(() => new Map(catalog.map((product) => [product.id, product])), [catalog]);
  const sets = useMemo(() => products.filter(isSet), [products]);
  const dishes = useMemo(() => products.filter((product) => !isSet(product)), [products]);
  const onSets = sets.length > 0 && state.category === SETS_PAGE && !query;
  // A search looks through everything, sets included; a page shows its own.
  const visible = (query ? products : dishes).filter((product) => {
    const categoryMatch = query || state.category === "ALLE" || state.category === FEATURED_PAGE || state.category === SETS_PAGE || product.category === state.category;
    const text = [product.sku, product.names.zh, product.names.de, product.names.en, product.category].join(" ").toLowerCase();
    return categoryMatch && (!query || text.includes(query));
  });
  // The promotions page, when there is one, is the first page of the menu.
  const categories = [...(featured ? [FEATURED_PAGE] : []), ...(sets.length ? [SETS_PAGE] : []), "ALLE", ...new Set(dishes.map((product) => product.category))];
  const activeProduct = state.activeProductId ? byId.get(state.activeProductId) : undefined;
  const table = assignedTableNo();
  const reduceMotion = useReducedMotion();

  // Every category is a page, in chip order. A search is one page of its own.
  const pageIndex = Math.max(0, categories.indexOf(state.category));
  const paging = !query && categories.length > 1;
  const nextPage = paging ? categories[pageIndex + 1] : undefined;
  const prevPage = paging && pageIndex > 0 ? categories[pageIndex - 1] : undefined;
  const pageName = (category: string) => (category === FEATURED_PAGE
    ? `✦ ${featured?.title || t(state.language, "featuredDefault")}`
    : category === SETS_PAGE ? t(state.language, "setsPage")
    : category === "ALLE" ? t(state.language, "allCategories") : category);

  // A guest's first look this visit is the promotions page, when there is one.
  // Once per session: after that the menu stays where they left it.
  useEffect(() => {
    if (!featured) return;
    try {
      if (sessionStorage.getItem("zy_featured_seen")) return;
      sessionStorage.setItem("zy_featured_seen", "1");
    } catch { /* storage refused: show it anyway, once per load */ }
    if (state.category === "ALLE") dispatch({ type: "category", category: FEATURED_PAGE });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [Boolean(featured)]);
  // Switched off while a guest was on it: back to everything.
  useEffect(() => {
    if (!categories.includes(state.category)) dispatch({ type: "category", category: "ALLE" });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [categories.join("|"), state.category, dispatch]);

  const stackRef = useRef<HTMLDivElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const chipsRef = useRef<HTMLElement>(null);
  // How the last turn went. `direction` is the side the new page comes in
  // from. `atEnd` is set only by pulling back past the top of a page: that
  // guest was reading upwards, so they land at the bottom of the page before,
  // where they left it. A chip or a button always opens a page at its top —
  // a page picked by name is read from its first line.
  const turn = useRef<{ direction: -1 | 0 | 1; atEnd: boolean }>({ direction: 0, atEnd: false });

  function turnTo(category: string, atEnd = false) {
    const target = categories.indexOf(category);
    turn.current.direction = target > pageIndex ? 1 : target < pageIndex ? -1 : 0;
    turn.current.atEnd = atEnd;
    if (category !== state.category) dispatch({ type: "category", category });
  }

  // Back to the top of a long page in one tap, once the guest is more than a
  // screen and a bit down it. Watched on the list's own scroller — the
  // header and the category bar never scroll, so they need no help.
  const [farDown, setFarDown] = useState(false);
  useEffect(() => {
    const stack = stackRef.current;
    if (!stack) return;
    let frame = 0;
    const check = () => { frame = 0; setFarDown(stack.scrollTop > stack.clientHeight * 1.2); };
    const onScroll = () => { if (!frame) frame = requestAnimationFrame(check); };
    stack.addEventListener("scroll", onScroll, { passive: true });
    check();
    return () => { stack.removeEventListener("scroll", onScroll); cancelAnimationFrame(frame); };
  }, []);

  usePageTurn({
    scroller: stackRef,
    sheet: sheetRef,
    canTurn: (direction: TurnDirection) => Boolean(direction === "next" ? nextPage : prevPage),
    onTurn: (direction: TurnDirection) => {
      const target = direction === "next" ? nextPage : prevPage;
      if (target) turnTo(target, direction === "prev");
    }
  });

  useLayoutEffect(() => {
    const stack = stackRef.current;
    if (stack) stack.scrollTop = turn.current.atEnd ? stack.scrollHeight : 0;
    turn.current.atEnd = false;
    // The chip for the page on screen stays in view as the pages turn.
    const chip = chipsRef.current?.querySelector<HTMLElement>(".chip.on");
    chip?.scrollIntoView?.({ inline: "center", block: "nearest", behavior: reduceMotion ? "auto" : "smooth" });
  }, [state.category, reduceMotion]);

  // The new page swings in like a leaf of a book hinged at its top edge,
  // from below for the next page and from above for the previous one.
  const enter = reduceMotion || turn.current.direction === 0
    ? { opacity: 0 }
    : { opacity: 0, y: 70 * turn.current.direction, rotateX: -24 * turn.current.direction, scale: 0.94 };

  return <section id="menu" className={`screen menu active ${activeProduct ? "detail-open" : ""} ${onFeatured || onSets ? "on-featured" : ""} ${state.searchOpen ? "search-open" : ""}`} data-featured-template={onFeatured ? featured?.template : onSets ? "framed" : undefined}>
    <header className="topbar">
      <button id="searchBtn" className="icon-btn" aria-label={t(state.language, "search")} onClick={() => dispatch({ type: "toggle-search" })}>⌕</button>
      {/* The hidden way into the admin console: seven taps within four
          seconds. On the web it opens admin.html, which asks for the password;
          in the Android kiosk shell it asks for the kiosk PIN first. */}
      <div className="title" role="button" tabIndex={0} onClick={() => void onAdminTap()} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") void onAdminTap(); }}>
        <FitTitle text={title} />{showTableNumber && table && <small>{t(state.language, "tableLabel").replace("{table}", table)}</small>}
      </div>
      <div className="topbar-end">
        {/* A flag per language the restaurant switched on, and none when there
            is only one: there would be nothing to switch to. */}
        {languages.length > 1 && <div className="flags" role="group" aria-label={t(state.language, "language")}>{languages.map((language) => <button
          key={language}
          className={`flag ${state.language === language ? "on" : ""}`}
          aria-label={LANGUAGE_INFO[language].name}
          aria-pressed={state.language === language}
          onClick={() => dispatch({ type: "language", language })}
        ><img src={LANGUAGE_INFO[language].flag} alt="" /></button>)}</div>}
        <button
          className="icon-btn scheme-toggle"
          aria-label={t(state.language, scheme === "dark" ? "lightMode" : "darkMode")}
          onClick={onToggleScheme}
        >{scheme === "dark" ? <SunIcon /> : <MoonIcon />}</button>
      </div>
    </header>
    <div id="searchBox" className={`search-box ${state.searchOpen ? "open" : ""}`}>
      <input id="searchInput" value={state.query} onChange={(event) => dispatch({ type: "query", query: event.target.value })} placeholder={t(state.language, "searchPlaceholder")} autoFocus={state.searchOpen} />
      <button id="clearSearch" onClick={() => dispatch({ type: "query", query: "" })}>{t(state.language, "clear")}</button>
    </div>
    <nav id="chips" ref={chipsRef} className="chips">{categories.map((category) => <button key={category} className={`chip ${category === FEATURED_PAGE ? "chip-featured" : ""} ${category === SETS_PAGE ? "chip-sets" : ""} ${state.category === category ? "on" : ""}`} aria-pressed={state.category === category} onClick={() => turnTo(category)}>{pageName(category)}</button>)}</nav>
    <div id="stack" ref={stackRef} className="stack">
      <div ref={sheetRef} className="page-sheet">
        {prevPage && <p className="page-hint page-hint-prev" aria-hidden="true"><i /><span className="page-hint-idle">↑ {t(state.language, "prevPage")} · {pageName(prevPage)}</span><span className="page-hint-armed">{t(state.language, "releaseToTurn")} · {pageName(prevPage)}</span></p>}
        <motion.div key={`${state.category}|${query}`} className={`stack-page ${turn.current.direction ? "turned" : ""}`}
          initial={enter}
          animate={{ opacity: 1, y: 0, rotateX: 0, scale: 1 }}
          transition={{ duration: reduceMotion ? 0 : DURATION.page, ease: EASE }}>
          {onFeatured && featured ? <FeaturedPage title={featured.title || t(state.language, "featuredDefault")} eyebrow={t(state.language, "featuredEyebrow")} template={featured.template} products={featured.products} byId={byId} language={state.language} onOpen={(productId) => dispatch({ type: "open-product", productId })} />
            : onSets ? <FeaturedPage title={t(state.language, "setsPage")} eyebrow={t(state.language, "setsEyebrow")} template="framed" products={sets} byId={byId} language={state.language} onOpen={(productId) => dispatch({ type: "open-product", productId })} />
            : visible.length ? visible.map((product, index) => <article key={product.id} className={`dish-card ${product.id === state.activeProductId ? "selected" : ""}`} data-id={product.id} style={index < 12 ? { "--row": index } as React.CSSProperties : undefined} onClick={() => dispatch({ type: "open-product", productId: product.id })}>
            <div className="summary">
              <DishPicture product={product} byId={byId} size="thumb" />
              {/* The code sits on its own small line above the name: drink
                  codes like BEER-NONALC are far wider than R1, and in a
                  column of their own they ran into the name. */}
              <div className="row-text">
                <span className="number">{product.sku}</span>
                <h3>{productName(product, state.language)}</h3>
                {secondaryName(product, state.language) && <p>{secondaryName(product, state.language)}</p>}
              </div>
              {/* A menu without prices sends a guest into every dish to find one. */}
              <span className="row-price">{formatPrice(product.priceCents, state.language)}</span>
            </div>
          </article>) : <div className="empty">{t(state.language, products.length ? "empty" : "unavailable")}</div>}
          {nextPage && <button type="button" className="page-next" onClick={() => turnTo(nextPage)}>
            <i className="page-next-progress" aria-hidden="true" />
            <span className="page-next-label"><b>{t(state.language, "nextPage")} · {pageName(nextPage)}</b><small className="page-hint-idle">{t(state.language, "pullForNext")}</small><small className="page-hint-armed">{t(state.language, "releaseToTurn")}</small></span>
            <span className="page-next-arrow" aria-hidden="true">→</span>
          </button>}
          {paging && !nextPage && visible.length > 0 && <p className="page-end">{t(state.language, "endOfMenu")}</p>}
        </motion.div>
      </div>
    </div>
    {/* Outside the list: the list is transformed while a page turns, and a
        fixed button inside it would move with the page. */}
    <button
      type="button"
      className={`to-top ${farDown && !activeProduct ? "on" : ""}`}
      aria-label={t(state.language, "backToTop")}
      title={t(state.language, "backToTop")}
      aria-hidden={!farDown || Boolean(activeProduct)}
      tabIndex={farDown && !activeProduct ? 0 : -1}
      onClick={() => stackRef.current?.scrollTo({ top: 0, behavior: reduceMotion ? "auto" : "smooth" })}
    ><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 19V5M5.5 11.5 12 5l6.5 6.5" /></svg></button>
    <AnimatePresence>{activeProduct && <ProductDetail key={activeProduct.id} product={activeProduct} byId={byId} state={state} dispatch={dispatch} />}</AnimatePresence>
  </section>;
}
