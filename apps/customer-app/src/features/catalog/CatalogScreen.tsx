import { useMemo } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { deconstruct, formatEuro, summarizeCart } from "@zhaoyun/domain";
import type { DishPart, ModifierGroup, ModifierOption, Product, SelectedModifier } from "@zhaoyun/domain";
import { allergenLabel } from "../../../../../src/allergens.js";
import { restaurantApi } from "../../app/api";
import type { CustomerDispatch, CustomerState } from "../../app/model";
import { tableNo } from "../../app/table";
import { productName, t } from "../../app/i18n";

interface Props { state: CustomerState; dispatch: CustomerDispatch; products: Product[]; offlineMenu?: boolean }

/**
 * Shared with the `--ease-out` / `--dur-*` tokens in styles.css. The CSS
 * `prefers-reduced-motion` block cannot reach these JS-driven animations, so
 * every duration goes through `useReducedMotion` below instead.
 */
const EASE = [0.2, 0.8, 0.2, 1] as const;
const DURATION = { backdrop: 0.2, card: 0.26, flip: 0.42 };

function localized(names: { zh: string; de: string; en: string }, language: CustomerState["language"]): string {
  return names[language] || names.de || names.en;
}

function toggleModifier(group: ModifierGroup, option: ModifierOption, selected: SelectedModifier[], language: CustomerState["language"]): SelectedModifier[] {
  const current = selected.filter((item) => group.options.some((candidate) => candidate.id === item.id));
  const exists = current.some((item) => item.id === option.id);
  const next = group.selection === "single" ? (exists ? [] : [{ id: option.id, name: localized(option.names, language), priceCents: option.priceCents }]) : exists ? current.filter((item) => item.id !== option.id) : [...current, { id: option.id, name: localized(option.names, language), priceCents: option.priceCents }];
  return [...selected.filter((item) => !group.options.some((candidate) => candidate.id === item.id)), ...next];
}

/**
 * One dish, however it is illustrated.
 *
 * None of the 111 dishes has a photo yet, so what a guest sees today is the
 * generated artwork. The slot is the same either way and appears in the list
 * as well as the detail card, so the day photos exist they turn up everywhere
 * at once rather than needing the layout rebuilt around them.
 */
function ProductMedia({ product, size = "feature" }: { product: Product; size?: "feature" | "thumb" }) {
  const media = product.media[0];
  if (!media) return <div className={`art ${size === "thumb" ? "art-thumb " : ""}${product.appearance.pattern}`} style={{ "--art": product.appearance.art } as React.CSSProperties} />;
  const source = restaurantApi.mediaUrl(media.url);
  const className = size === "thumb" ? "dish-media dish-media-thumb" : "dish-media";
  return media.type === "video"
    ? <video className={className} src={source} poster={media.posterUrl ? restaurantApi.mediaUrl(media.posterUrl) : undefined} playsInline muted loop autoPlay preload="metadata" />
    : <img className={className} src={source} alt={product.names.zh || product.names.de} loading="lazy" />;
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
function Deconstruction({ product, language, reduceMotion }: { product: Product; language: CustomerState["language"]; reduceMotion: boolean }) {
  const { parts, portions, unattributed } = useMemo(() => deconstruct(product), [product]);
  const name = (part: DishPart) => (language === "zh" ? part.zh : language === "en" ? part.en : part.de);
  const second = (part: DishPart) => (language === "de" ? part.zh : part.de);

  return <div className="dish-parts-block">
    <p className="parts-heading">{t(language, "parts")}</p>
    <ol className="dish-parts">{parts.map((part, index) => <motion.li className="dish-part" key={`${part.de}-${index}`}
      initial={reduceMotion ? false : { opacity: 0, y: 14, rotateX: -12 }}
      animate={{ opacity: 1, y: 0, rotateX: 0 }}
      transition={{ delay: reduceMotion ? 0 : 0.06 + index * 0.05, duration: reduceMotion ? 0 : 0.32, ease: EASE }}>
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

function ProductDetail({ product, state, dispatch }: { product: Product; state: CustomerState; dispatch: CustomerDispatch }) {
  const reduceMotion = useReducedMotion();
  const seconds = (value: number) => (reduceMotion ? 0 : value);

  return <motion.div id="dishOverlay" className="dish-overlay open" aria-hidden="false"
    initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
    transition={{ duration: seconds(DURATION.backdrop), ease: EASE }}
    onClick={(event) => {
      if (event.target === event.currentTarget) dispatch({ type: "close-product" });
    }}>
    <motion.div className="dish-detail-card" data-detail-id={product.id} initial={{ y: 16, scale: 0.985 }} animate={{ y: 0, scale: 1 }} exit={{ y: 10, scale: 0.99 }} transition={{ duration: seconds(DURATION.card), ease: EASE }}>
      <button className="detail-close" aria-label={t(state.language, "close")} onClick={() => dispatch({ type: "close-product" })}>×</button>
      <motion.div className={`detail-flip-inner ${state.productFlipped ? "flipped" : ""}`} animate={{ rotateY: state.productFlipped ? 180 : 0 }} transition={{ duration: seconds(DURATION.flip), ease: EASE }}>
        <section className="detail-face detail-front" aria-label={t(state.language, "flip")} onClick={() => dispatch({ type: "toggle-product-flip" })}>
          <div className="detail-heading">
            <span className="number">{product.sku}</span><span className="cat">{product.category}</span>
            <h3>{productName(product, state.language)}</h3><p>{product.names.de}</p>
          </div>
          <div className="detail-scroll">
            <div className="feature">
              <ProductMedia product={product} />
              <div><h4>{product.names.en}</h4><p>{product.description}</p></div>
            </div>
            {product.modifiers?.length ? <p className="modifier-heading">{t(state.language, "customize")}</p> : null}
            {product.modifiers?.map((group) => <fieldset className="modifier-group" key={group.id} onClick={(event) => event.stopPropagation()}>
              <legend>{localized(group.names, state.language)}</legend>
              <div className="modifier-options">{group.options.map((option) => {
                const checked = state.detailModifiers.some((modifier) => modifier.id === option.id);
                return <label className={`modifier-option ${checked ? "selected" : ""}`} key={option.id}>
                  <input type={group.selection === "single" ? "radio" : "checkbox"} name={`modifier-${product.id}-${group.id}`} checked={checked} onChange={() => dispatch({ type: "detail-modifiers", modifiers: toggleModifier(group, option, state.detailModifiers, state.language) })} />
                  <span>{localized(option.names, state.language)}</span>{option.priceCents > 0 && <b>+{formatEuro(option.priceCents)}</b>}
                </label>;
              })}</div>
            </fieldset>)}
            <div className="meta"><span>{product.details.time}</span><span>{product.details.people}</span><span>{product.details.level}</span></div>
          </div>
          <div className="detail-buy">
            <div className="buyline"><strong>{formatEuro(product.priceCents)}</strong><div className="qty">
              <button onClick={(event) => { event.stopPropagation(); dispatch({ type: "detail-quantity", quantity: state.detailQuantity - 1 }); }}>−</button>
              <span data-qty-for={product.id}>{state.detailQuantity}</span>
              <button onClick={(event) => { event.stopPropagation(); dispatch({ type: "detail-quantity", quantity: state.detailQuantity + 1 }); }}>＋</button>
            </div></div>
            <button className="primary add" onClick={(event) => {
              event.stopPropagation();
              dispatch({ type: "add-to-cart", productId: product.id, quantity: state.detailQuantity, modifiers: state.detailModifiers });
              dispatch({ type: "toast", message: t(state.language, "add") });
            }}>{t(state.language, "add")}</button>
          </div>
        </section>
        <section className="detail-face detail-back" aria-label={t(state.language, "detailRegion")} onClick={() => dispatch({ type: "toggle-product-flip" })}>
          <button className="flip-back" onClick={(event) => { event.stopPropagation(); dispatch({ type: "toggle-product-flip" }); }}>{t(state.language, "back")}</button>
          <div><small>{product.sku} · {t(state.language, "breakdown")}</small><h3>{productName(product, state.language)}</h3><p>{product.description}</p></div>
          <div className="detail-back-scroll" onClick={(event) => event.stopPropagation()}>
            <Deconstruction product={product} language={state.language} reduceMotion={Boolean(reduceMotion)} />
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

export function CatalogScreen({ state, dispatch, products, offlineMenu = false }: Props) {
  const query = state.query.trim().toLowerCase();
  const visible = products.filter((product) => {
    const categoryMatch = state.category === "ALLE" || product.category === state.category;
    const text = [product.sku, product.names.zh, product.names.de, product.names.en, product.category].join(" ").toLowerCase();
    return categoryMatch && (!query || text.includes(query));
  });
  const categories = ["ALLE", ...new Set(products.map((product) => product.category))];
  const lines = Object.values(state.cart);
  const summary = summarizeCart(lines, products);
  const activeProduct = products.find((product) => product.id === state.activeProductId);

  return <section id="menu" className={`screen menu active ${activeProduct ? "detail-open" : ""}`}>
    <header className="topbar">
      <button className="icon-btn back" aria-label={t(state.language, "goBack")} onClick={() => dispatch({ type: "navigate", screen: "home" })}>‹</button>
      <div className="title"><strong>La Carte</strong><small>TISCH {tableNo()}</small></div>
      <button id="searchBtn" className="icon-btn" aria-label={t(state.language, "search")} onClick={() => dispatch({ type: "toggle-search" })}>⌕</button>
    </header>
    <div id="searchBox" className={`search-box ${state.searchOpen ? "open" : ""}`}>
      <input id="searchInput" value={state.query} onChange={(event) => dispatch({ type: "query", query: event.target.value })} placeholder={`${t(state.language, "search")} / SKU`} autoFocus={state.searchOpen} />
      <button id="clearSearch" onClick={() => dispatch({ type: "query", query: "" })}>{t(state.language, "clear")}</button>
    </div>
    {offlineMenu && <p className="local-board-note">{t(state.language, "menuOffline")}</p>}
    <nav id="chips" className="chips">{categories.map((category) => <button key={category} className={`chip ${state.category === category ? "on" : ""}`} onClick={() => dispatch({ type: "category", category })}>{category}</button>)}</nav>
    <div id="stack" className="stack">{visible.length ? visible.map((product) => <article key={product.id} className={`dish-card ${product.id === state.activeProductId ? "selected" : ""}`} data-id={product.id} onClick={() => dispatch({ type: "open-product", productId: product.id })}>
      <div className="summary">
        <ProductMedia product={product} size="thumb" />
        <span className="number">{product.sku}</span>
        <div><h3>{productName(product, state.language)}</h3><p>{product.names.de}</p></div>
        {/* A menu without prices sends a guest into every dish to find one. */}
        <span className="row-price">{formatEuro(product.priceCents)}</span>
      </div>
    </article>) : <div className="empty">{t(state.language, products.length ? "empty" : "unavailable")}</div>}</div>
    <AnimatePresence>{activeProduct && <ProductDetail key={activeProduct.id} product={activeProduct} state={state} dispatch={dispatch} />}</AnimatePresence>
    <button className="cartbar" onClick={() => dispatch({ type: "navigate", screen: "cart" })}><span>{t(state.language, "cart")}</span><b id="cartCount">{summary.count}</b><em id="cartTotal">{formatEuro(summary.totalCents)}</em></button>
  </section>;
}
