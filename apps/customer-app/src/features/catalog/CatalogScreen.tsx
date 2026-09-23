import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { deconstruct, LANGUAGE_INFO } from "@zhaoyun/domain";
import type { DishPart, MenuLanguage, Product } from "@zhaoyun/domain";
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
  products: Product[];
  /** The languages the restaurant switched on, in flag order. */
  languages: MenuLanguage[];
  /** The heading the owner set; "La Carte" until they set one. */
  title: string;
  showTableNumber: boolean;
  scheme: ColorScheme;
  onToggleScheme: () => void;
  /** Counts taps on the title; the seventh within four seconds opens the admin console. */
  onAdminTap: () => Promise<void>;
}

/**
 * Shared with the `--ease-out` / `--dur-*` tokens in styles.css. The CSS
 * `prefers-reduced-motion` block cannot reach these JS-driven animations, so
 * every duration goes through `useReducedMotion` below instead.
 */
const EASE = [0.2, 0.8, 0.2, 1] as const;
const DURATION = { backdrop: 0.2, card: 0.3, page: 0.34 };
/** The card turns like a card: quick off the mark, settling without a wobble. */
const FLIP_SPRING = { type: "spring", stiffness: 210, damping: 26, mass: 0.9 } as const;

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

/** Whose photo it is, when it is not the restaurant's own. */
function PhotoCredit({ product }: { product: Product }) {
  const credit = product.media[0]?.credit;
  return credit ? <small className="photo-credit">📷 {credit}</small> : null;
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

/**
 * A 套餐 (combo) is an ordinary product — its own name, price and photo — that
 * also names the existing dishes it bundles. `bundleItems` only carries ids
 * and quantities, so rendering it needs the full product list to look the
 * names up; a dish removed from the catalogue after a combo was built is
 * silently skipped rather than shown as a blank line.
 */
function BundleContents({ product, products, language }: { product: Product; products: Product[]; language: CustomerState["language"] }) {
  if (!product.bundleItems?.length) return null;
  const byId = new Map(products.map((item) => [item.id, item]));
  return <div className="bundle-items">
    <p className="modifier-heading">{t(language, "bundleIncludes")}</p>
    <ul className="bundle-items-list">
      {product.bundleItems.map((item) => {
        const dish = byId.get(item.productId);
        if (!dish) return null;
        return <li key={item.productId}>{item.quantity > 1 ? `${item.quantity}× ` : ""}{productName(dish, language)}</li>;
      })}
    </ul>
  </div>;
}

function ProductDetail({ product, products, state, dispatch }: { product: Product; products: Product[]; state: CustomerState; dispatch: CustomerDispatch }) {
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
        animate={{ rotateY: state.productFlipped ? 180 : 0, scale: reduceMotion ? 1 : [1, 0.94, 1] }}
        transition={reduceMotion ? { duration: 0 } : { rotateY: FLIP_SPRING, scale: { duration: 0.5, times: [0, 0.45, 1], ease: EASE } }}>
        <section className="detail-face detail-front" aria-label={t(state.language, "flip")} onClick={() => dispatch({ type: "toggle-product-flip" })}>
          <div className="detail-heading">
            <span className="number">{product.sku}</span><span className="cat">{product.category}</span>
            <h3>{productName(product, state.language)}</h3>{secondaryName(product, state.language) && <p>{secondaryName(product, state.language)}</p>}
          </div>
          <div className="detail-scroll">
            <div className="feature">
              <figure className="feature-media"><ProductMedia product={product} /><PhotoCredit product={product} /></figure>
              <div><p>{product.description}</p></div>
            </div>
            <DishOptions product={product} language={state.language} />
            <BundleContents product={product} products={products} language={state.language} />
            <div className="meta"><span>{product.details.time}</span><span>{product.details.people}</span><span>{product.details.level}</span></div>
          </div>
          <div className="detail-buy">
            <div className="buyline"><strong>{formatPrice(product.priceCents, state.language)}</strong></div>
          </div>
        </section>
        <section className="detail-face detail-back" aria-label={t(state.language, "detailRegion")} onClick={() => dispatch({ type: "toggle-product-flip" })}>
          <button className="flip-back" onClick={(event) => { event.stopPropagation(); dispatch({ type: "toggle-product-flip" }); }}>{t(state.language, "back")}</button>
          <div><small>{product.sku} · {t(state.language, "breakdown")}</small><h3>{productName(product, state.language)}</h3><p>{product.description}</p></div>
          <div className="detail-back-scroll" onClick={(event) => event.stopPropagation()}>
            <Deconstruction product={product} language={state.language} reduceMotion={Boolean(reduceMotion)} showing={state.productFlipped} />
            <dl>
              {/* The declared list stays whole and stays first among the facts:
                  it is the legal statement, and the breakdown above only
                  explains it. */}
              <div><dt>{t(state.language, "allergens")}</dt><dd>{product.allergens.length
                ? <span className="allergen-list">{product.allergens.map((code) => <b className="allergen" key={code} title={allergenLabel(code, state.language)}>{code} {allergenLabel(code, state.language)}</b>)}</span>
                : "—"}</dd></div>
              <div><dt>{t(state.language, "time")}</dt><dd>{product.details.time}</dd></div>
              <div><dt>{t(state.language, "portion")}</dt><dd>{product.details.people} · {product.details.level}</dd></div>
            </dl>
          </div>
        </section>
      </motion.div>
    </motion.div>
  </motion.div>;
}

export function CatalogScreen({ state, dispatch, products, languages, title, showTableNumber, scheme, onToggleScheme, onAdminTap }: Props) {
  const query = state.query.trim().toLowerCase();
  const visible = products.filter((product) => {
    const categoryMatch = state.category === "ALLE" || product.category === state.category;
    const text = [product.sku, product.names.zh, product.names.de, product.names.en, product.category].join(" ").toLowerCase();
    return categoryMatch && (!query || text.includes(query));
  });
  const categories = ["ALLE", ...new Set(products.map((product) => product.category))];
  const activeProduct = products.find((product) => product.id === state.activeProductId);
  const table = assignedTableNo();
  const reduceMotion = useReducedMotion();

  // Every category is a page, in chip order. A search is one page of its own.
  const pageIndex = Math.max(0, categories.indexOf(state.category));
  const paging = !query && categories.length > 1;
  const nextPage = paging ? categories[pageIndex + 1] : undefined;
  const prevPage = paging && pageIndex > 0 ? categories[pageIndex - 1] : undefined;
  const pageName = (category: string) => (category === "ALLE" ? t(state.language, "allCategories") : category);

  const stackRef = useRef<HTMLDivElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const chipsRef = useRef<HTMLElement>(null);
  // Which way the last turn went: the new page comes in from that side, and
  // going back lands at the bottom of the previous page, where the guest was.
  const turn = useRef<{ direction: -1 | 0 | 1 }>({ direction: 0 });

  function turnTo(category: string) {
    const target = categories.indexOf(category);
    turn.current.direction = target > pageIndex ? 1 : target < pageIndex ? -1 : 0;
    if (category !== state.category) dispatch({ type: "category", category });
  }

  usePageTurn({
    scroller: stackRef,
    sheet: sheetRef,
    canTurn: (direction: TurnDirection) => Boolean(direction === "next" ? nextPage : prevPage),
    onTurn: (direction: TurnDirection) => {
      const target = direction === "next" ? nextPage : prevPage;
      if (target) turnTo(target);
    }
  });

  useLayoutEffect(() => {
    const stack = stackRef.current;
    if (stack) stack.scrollTop = turn.current.direction < 0 ? stack.scrollHeight : 0;
    // The chip for the page on screen stays in view as the pages turn.
    const chip = chipsRef.current?.querySelector<HTMLElement>(".chip.on");
    chip?.scrollIntoView?.({ inline: "center", block: "nearest", behavior: reduceMotion ? "auto" : "smooth" });
  }, [state.category, reduceMotion]);

  const enter = reduceMotion || turn.current.direction === 0
    ? { opacity: 0 }
    : { opacity: 0, y: 44 * turn.current.direction, rotateX: -7 * turn.current.direction };

  return <section id="menu" className={`screen menu active ${activeProduct ? "detail-open" : ""}`}>
    <header className="topbar">
      <button id="searchBtn" className="icon-btn" aria-label={t(state.language, "search")} onClick={() => dispatch({ type: "toggle-search" })}>⌕</button>
      {/* The hidden way into the admin console: seven taps within four
          seconds. On the web it opens admin.html, which asks for the password;
          in the Android kiosk shell it asks for the kiosk PIN first. */}
      <div className="title" role="button" tabIndex={0} onClick={() => void onAdminTap()} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") void onAdminTap(); }}>
        <strong>{title}</strong>{showTableNumber && table && <small>{t(state.language, "tableLabel").replace("{table}", table)}</small>}
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
        >{scheme === "dark" ? "☀" : "☾"}</button>
      </div>
    </header>
    <div id="searchBox" className={`search-box ${state.searchOpen ? "open" : ""}`}>
      <input id="searchInput" value={state.query} onChange={(event) => dispatch({ type: "query", query: event.target.value })} placeholder={t(state.language, "searchPlaceholder")} autoFocus={state.searchOpen} />
      <button id="clearSearch" onClick={() => dispatch({ type: "query", query: "" })}>{t(state.language, "clear")}</button>
    </div>
    <nav id="chips" ref={chipsRef} className="chips">{categories.map((category) => <button key={category} className={`chip ${state.category === category ? "on" : ""}`} aria-pressed={state.category === category} onClick={() => turnTo(category)}>{pageName(category)}</button>)}</nav>
    <div id="stack" ref={stackRef} className="stack">
      <div ref={sheetRef} className="page-sheet">
        {prevPage && <p className="page-hint page-hint-prev" aria-hidden="true"><i /><span className="page-hint-idle">↑ {t(state.language, "prevPage")} · {pageName(prevPage)}</span><span className="page-hint-armed">{t(state.language, "releaseToTurn")} · {pageName(prevPage)}</span></p>}
        <motion.div key={`${state.category}|${query}`} className="stack-page"
          initial={enter}
          animate={{ opacity: 1, y: 0, rotateX: 0 }}
          transition={{ duration: reduceMotion ? 0 : DURATION.page, ease: EASE }}>
          {visible.length ? visible.map((product) => <article key={product.id} className={`dish-card ${product.id === state.activeProductId ? "selected" : ""}`} data-id={product.id} onClick={() => dispatch({ type: "open-product", productId: product.id })}>
            <div className="summary">
              <ProductMedia product={product} size="thumb" />
              <span className="number">{product.sku}</span>
              <div><h3>{productName(product, state.language)}</h3>{secondaryName(product, state.language) && <p>{secondaryName(product, state.language)}</p>}</div>
              {/* A menu without prices sends a guest into every dish to find one. */}
              <span className="row-price">{formatPrice(product.priceCents, state.language)}</span>
            </div>
          </article>) : <div className="empty">{t(state.language, products.length ? "empty" : "unavailable")}</div>}
          {nextPage && <button type="button" className="page-next" onClick={() => turnTo(nextPage)}>
            <i className="page-next-progress" aria-hidden="true" />
            <span className="page-next-label"><b>{t(state.language, "nextPage")} · {pageName(nextPage)}</b><small className="page-hint-idle">{t(state.language, "pullForNext")}</small><small className="page-hint-armed">{t(state.language, "releaseToTurn")}</small></span>
            <span className="page-next-arrow" aria-hidden="true">↓</span>
          </button>}
          {paging && !nextPage && visible.length > 0 && <p className="page-end">{t(state.language, "endOfMenu")}</p>}
        </motion.div>
      </div>
    </div>
    <AnimatePresence>{activeProduct && <ProductDetail key={activeProduct.id} product={activeProduct} products={products} state={state} dispatch={dispatch} />}</AnimatePresence>
  </section>;
}
