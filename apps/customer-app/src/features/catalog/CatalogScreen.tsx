import { useLayoutEffect, useRef } from "react";
import { formatEuro, summarizeCart } from "@zhaoyun/domain";
import type { Product } from "@zhaoyun/domain";
import { restaurantApi } from "../../app/api";
import type { CustomerDispatch, CustomerState } from "../../app/model";

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
  const cardRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    cardRef.current?.animate([
      { transform: "translateY(18px) scale(.96)", opacity: 0.4 },
      { transform: "translateY(0) scale(1)", opacity: 1 }
    ], { duration: 420, easing: "cubic-bezier(.2,.8,.2,1)", fill: "both" });
  }, [product.id]);

  return <div id="dishOverlay" className="dish-overlay open" aria-hidden="false" onClick={(event) => {
    if (event.target === event.currentTarget) dispatch({ type: "close-product" });
  }}>
    <div ref={cardRef} className="dish-detail-card" data-detail-id={product.id}>
      <button className="detail-close" aria-label="关闭详情" onClick={() => dispatch({ type: "close-product" })}>×</button>
      <div className={`detail-flip-inner ${state.productFlipped ? "flipped" : ""}`}>
        <section className="detail-face detail-front">
          <div className="detail-heading">
            <span className="number">{product.sku}</span><span className="cat">{product.category}</span>
            <h3>{product.names.zh || product.names.de || product.names.en}</h3><p>{product.names.de}</p>
          </div>
          <button className="flip-action" onClick={() => dispatch({ type: "toggle-product-flip" })} aria-label="翻转查看食材">详情翻转</button>
          <div className="detail-scroll">
            <div className="feature">
              <ProductMedia product={product} />
              <div><h4>{product.names.en}</h4><p>{product.description}</p></div>
            </div>
            <div className="meta"><span>{product.details.time}</span><span>{product.details.people}</span><span>{product.details.level}</span></div>
          </div>
          <div className="detail-buy">
            <div className="buyline"><strong>{formatEuro(product.priceCents)}</strong><div className="qty">
              <button onClick={() => dispatch({ type: "detail-quantity", quantity: state.detailQuantity - 1 })}>−</button>
              <span data-qty-for={product.id}>{state.detailQuantity}</span>
              <button onClick={() => dispatch({ type: "detail-quantity", quantity: state.detailQuantity + 1 })}>＋</button>
            </div></div>
            <button className="primary add" onClick={() => {
              dispatch({ type: "add-to-cart", productId: product.id, quantity: state.detailQuantity });
              dispatch({ type: "toast", message: "已加入购物车" });
            }}>加入购物车 · IN DEN WARENKORB</button>
          </div>
        </section>
        <section className="detail-face detail-back" aria-label="菜品详细信息">
          <button className="flip-back" onClick={() => dispatch({ type: "toggle-product-flip" })}>返回正面</button>
          <div><small>{product.sku} · {product.category}</small><h3>{product.names.zh}</h3><p>{product.description}</p></div>
          <dl>
            <div><dt>主要食材</dt><dd>{product.details.ingredients}</dd></div>
            <div><dt>过敏原</dt><dd>{product.allergens.join(", ") || "—"}</dd></div>
            <div><dt>制作时间</dt><dd>{product.details.time}</dd></div>
            <div><dt>份量 / 难度</dt><dd>{product.details.people} · {product.details.level}</dd></div>
          </dl>
        </section>
      </div>
    </div>
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

  return <section id="menu" className={`screen menu active ${activeProduct ? "detail-open" : ""}`}>
    <header className="topbar">
      <button className="icon-btn back" aria-label="返回" onClick={() => dispatch({ type: "navigate", screen: "home" })}>‹</button>
      <div className="title"><strong>La Carte</strong><small>TISCH 08</small></div>
      <button id="searchBtn" className="icon-btn" aria-label="搜索" onClick={() => dispatch({ type: "toggle-search" })}>⌕</button>
    </header>
    <div id="searchBox" className={`search-box ${state.searchOpen ? "open" : ""}`}>
      <input id="searchInput" value={state.query} onChange={(event) => dispatch({ type: "query", query: event.target.value })} placeholder="菜名 / Gericht / SKU" autoFocus={state.searchOpen} />
      <button id="clearSearch" onClick={() => dispatch({ type: "query", query: "" })}>清除</button>
    </div>
    <nav id="chips" className="chips">{categories.map((category) => <button key={category} className={`chip ${state.category === category ? "on" : ""}`} onClick={() => dispatch({ type: "category", category })}>{category}</button>)}</nav>
    <div id="stack" className="stack">{visible.length ? visible.map((product) => <article key={product.id} className={`dish-card ${product.id === state.activeProductId ? "selected" : ""}`} data-id={product.id} onClick={() => dispatch({ type: "open-product", productId: product.id, quantity: state.cart[product.id] ?? 1 })}>
      <div className="summary"><span className="number">{product.sku}</span><div><h3>{product.names.zh || product.names.de}</h3><p>{product.names.de}</p></div><span className="cat">{product.category}</span></div>
    </article>) : <div className="empty">没有找到商品</div>}</div>
    {activeProduct && <ProductDetail product={activeProduct} state={state} dispatch={dispatch} />}
    <button className="cartbar" onClick={() => dispatch({ type: "navigate", screen: "cart" })}><span>购物车 · WARENKORB</span><b id="cartCount">{summary.count}</b><em id="cartTotal">{formatEuro(summary.totalCents)}</em></button>
  </section>;
}
