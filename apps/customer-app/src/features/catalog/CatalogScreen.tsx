import { AnimatePresence, LayoutGroup, motion } from "motion/react";
import { formatEuro, summarizeCart } from "@zhaoyun/domain";
import type { Product } from "@zhaoyun/domain";
import { restaurantApi } from "../../app/api";
import type { CustomerDispatch, CustomerState } from "../../app/model";
import { productName, t } from "../../app/i18n";
import { LanguageSwitcher } from "../../components/LanguageSwitcher";

interface Props { state: CustomerState; dispatch: CustomerDispatch; products: Product[] }

function ProductMedia({ product }: { product: Product }) {
  const media = product.media[0];
  if (!media) return <div className={`art ${product.appearance.pattern}`} style={{ "--art": product.appearance.art } as React.CSSProperties} />;
  const source = restaurantApi.mediaUrl(media.url);
  return media.type === "video"
    ? <video className="dish-media" src={source} poster={media.posterUrl ? restaurantApi.mediaUrl(media.posterUrl) : undefined} playsInline muted loop autoPlay />
    : <img className="dish-media" src={source} alt={product.names.zh || product.names.de} />;
}

function ProductDetail({ product, state, dispatch }: { product: Product; state: CustomerState; dispatch: CustomerDispatch }) {
  return <div id="dishOverlay" className="dish-overlay open" aria-hidden="false" onClick={(event) => {
    if (event.target === event.currentTarget) dispatch({ type: "close-product" });
  }}>
    <motion.div layoutId={`dish-card-${product.id}`} className="dish-detail-card" data-detail-id={product.id} initial={{ opacity: 0, y: 28, scale: 0.94, rotateX: 7 }} animate={{ opacity: 1, y: 0, scale: 1, rotateX: 0 }} transition={{ type: "spring", stiffness: 280, damping: 24 }}>
      <button className="detail-close" aria-label="关闭详情" onClick={() => dispatch({ type: "close-product" })}>×</button>
      <motion.div className={`detail-flip-inner ${state.productFlipped ? "flipped" : ""}`} animate={{ rotateY: state.productFlipped ? 180 : 0 }} transition={{ type: "spring", stiffness: 220, damping: 22, mass: 0.8 }}>
        <motion.section className="detail-face detail-front" aria-label={t(state.language, "flip")} onClick={() => dispatch({ type: "toggle-product-flip" })} initial={{ opacity: 0, x: -14 }} animate={{ opacity: state.productFlipped ? 0 : 1, x: 0 }} transition={{ delay: state.productFlipped ? 0 : 0.16, duration: 0.28 }}>
          <div className="detail-heading">
            <span className="number">{product.sku}</span><span className="cat">{product.category}</span>
            <h3>{productName(product, state.language)}</h3><p>{product.names.de}</p>
          </div>
          <div className="detail-scroll">
            <motion.div className="feature" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.22, duration: 0.34 }}>
              <ProductMedia product={product} />
              <div><h4>{product.names.en}</h4><p>{product.description}</p></div>
            </motion.div>
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
              dispatch({ type: "add-to-cart", productId: product.id, quantity: state.detailQuantity });
              dispatch({ type: "toast", message: t(state.language, "add") });
            }}>{t(state.language, "add")}</button>
          </div>
        </motion.section>
        <motion.section className="detail-face detail-back" aria-label="菜品详细信息" onClick={() => dispatch({ type: "toggle-product-flip" })} initial={{ opacity: 0 }} animate={{ opacity: state.productFlipped ? 1 : 0 }} transition={{ delay: state.productFlipped ? 0.18 : 0, duration: 0.28 }}>
          <button className="flip-back" onClick={(event) => { event.stopPropagation(); dispatch({ type: "toggle-product-flip" }); }}>{t(state.language, "back")}</button>
          <div><small>{product.sku} · {product.category}</small><h3>{productName(product, state.language)}</h3><p>{product.description}</p></div>
          <dl>
            <div><dt>{t(state.language, "ingredients")}</dt><dd>{product.details.ingredients}</dd></div>
            <div><dt>{t(state.language, "allergens")}</dt><dd>{product.allergens.join(", ") || "—"}</dd></div>
            <div><dt>{t(state.language, "time")}</dt><dd>{product.details.time}</dd></div>
            <div><dt>{t(state.language, "portion")}</dt><dd>{product.details.people} · {product.details.level}</dd></div>
          </dl>
        </motion.section>
      </motion.div>
    </motion.div>
  </div>;
}

export function CatalogScreen({ state, dispatch, products }: Props) {
  const query = state.query.trim().toLowerCase();
  const visible = products.filter((product) => {
    const categoryMatch = state.category === "ALLE" || product.category === state.category;
    const text = [product.sku, product.names.zh, product.names.de, product.names.en, product.category].join(" ").toLowerCase();
    return categoryMatch && (!query || text.includes(query));
  });
  const categories = ["ALLE", ...new Set(products.map((product) => product.category))];
  const lines = Object.entries(state.cart).map(([productId, quantity]) => ({ productId, quantity }));
  const summary = summarizeCart(lines, products);
  const activeProduct = products.find((product) => product.id === state.activeProductId);

  return <LayoutGroup id="catalog-cards"><section id="menu" className={`screen menu active ${activeProduct ? "detail-open" : ""}`}>
    <header className="topbar">
      <button className="icon-btn back" aria-label="返回" onClick={() => dispatch({ type: "navigate", screen: "home" })}>‹</button>
      <div className="title"><strong>La Carte</strong><small>TISCH 08</small></div>
      <LanguageSwitcher language={state.language} dispatch={dispatch} /><button id="searchBtn" className="icon-btn" aria-label={t(state.language, "search")} onClick={() => dispatch({ type: "toggle-search" })}>⌕</button>
    </header>
    <div id="searchBox" className={`search-box ${state.searchOpen ? "open" : ""}`}>
      <input id="searchInput" value={state.query} onChange={(event) => dispatch({ type: "query", query: event.target.value })} placeholder={`${t(state.language, "search")} / SKU`} autoFocus={state.searchOpen} />
      <button id="clearSearch" onClick={() => dispatch({ type: "query", query: "" })}>{t(state.language, "clear")}</button>
    </div>
    <nav id="chips" className="chips">{categories.map((category) => <button key={category} className={`chip ${state.category === category ? "on" : ""}`} onClick={() => dispatch({ type: "category", category })}>{category}</button>)}</nav>
    <div id="stack" className="stack">{visible.length ? visible.map((product) => <motion.article layoutId={`dish-card-${product.id}`} key={product.id} className={`dish-card ${product.id === state.activeProductId ? "selected" : ""}`} data-id={product.id} onClick={() => dispatch({ type: "open-product", productId: product.id, quantity: state.cart[product.id] ?? 1 })} transition={{ type: "spring", stiffness: 260, damping: 24 }}>
      <div className="summary"><span className="number">{product.sku}</span><div><h3>{productName(product, state.language)}</h3><p>{product.names.de}</p></div><span className="cat">{product.category}</span></div>
    </motion.article>) : <div className="empty">{t(state.language, "empty")}</div>}</div>
    <AnimatePresence mode="wait">{activeProduct && <ProductDetail key={activeProduct.id} product={activeProduct} state={state} dispatch={dispatch} />}</AnimatePresence>
    <button className="cartbar" onClick={() => dispatch({ type: "navigate", screen: "cart" })}><span>{t(state.language, "cart")}</span><b id="cartCount">{summary.count}</b><em id="cartTotal">{formatEuro(summary.totalCents)}</em></button>
  </section></LayoutGroup>;
}
