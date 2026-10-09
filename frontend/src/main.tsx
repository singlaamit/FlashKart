import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { createUser, listProducts } from "./api";
import type { Product } from "./api";
import { FlashSalePage } from "./components/FlashSalePage";
import "./styles.css";

const USER_KEY = "flashkart:userId";

const readUser = () => {
  try {
    return localStorage.getItem(USER_KEY);
  } catch {
    return null;
  }
};

function SignIn({ onSignIn }: { onSignIn: (id: string) => void }) {
  const [id, setId] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function createDemoUser() {
    setBusy(true);
    setError("");
    try {
      const n = Math.random().toString(36).slice(2, 8);
      const { data } = await createUser(`Demo ${n}`, `demo-${n}@example.com`);
      onSignIn(data.id);
    } catch {
      setError("Could not create a user. Is the backend running?");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card sign-in">
      <h2>Welcome to FlashKart</h2>
      <p className="muted">Create a demo user, or paste an existing user ID (from the seed output).</p>
      <button className="primary" onClick={createDemoUser} disabled={busy}>
        {busy ? "Creating…" : "Create demo user"}
      </button>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSignIn(id.trim());
        }}
      >
        <input placeholder="User ID (uuid)" value={id} onChange={(e) => setId(e.target.value)} required />
        <button type="submit">Use this ID</button>
      </form>
      {error && <p className="notice error">{error}</p>}
    </div>
  );
}

function App() {
  const [userId, setUserId] = useState(() => new URLSearchParams(location.search).get("user") ?? readUser());
  const [products, setProducts] = useState<Product[]>([]);
  const [productId, setProductId] = useState(() => new URLSearchParams(location.search).get("product") ?? "");
  const [listError, setListError] = useState(false);

  useEffect(() => {
    listProducts()
      .then(({ data }) => {
        setProducts(data);
        setProductId((current) => (data.some((p) => p.id === current) ? current : (data[0]?.id ?? "")));
      })
      .catch(() => setListError(true));
  }, []);

  function signIn(id: string) {
    try {
      localStorage.setItem(USER_KEY, id);
    } catch {
      /* private mode: user stays signed in for this tab only */
    }
    setUserId(id);
  }

  function signOut() {
    try {
      localStorage.removeItem(USER_KEY);
    } catch {
      /* ignore */
    }
    history.replaceState(null, "", location.pathname);
    setUserId(null);
  }

  return (
    <div className="shell">
      <header className="topbar">
        <h1>⚡ FlashKart</h1>
        {userId && (
          <span className="muted">
            {userId.slice(0, 8)}… <button onClick={signOut}>Switch user</button>
          </span>
        )}
      </header>

      {!userId ? (
        <SignIn onSignIn={signIn} />
      ) : listError ? (
        <p className="notice error">Could not load products. Is the backend running on port 3000?</p>
      ) : products.length === 0 ? (
        <p className="muted">No products yet. Run <code>npm run seed</code> in the backend.</p>
      ) : (
        <>
          <nav className="picker" aria-label="Products">
            {products.map((p) => (
              <button
                key={p.id}
                className={p.id === productId ? "chip active" : "chip"}
                onClick={() => setProductId(p.id)}
              >
                {p.name}
              </button>
            ))}
          </nav>
          {/* key: switching product resets quantity, timers and polling */}
          <FlashSalePage key={productId} userId={userId} productId={productId} />
        </>
      )}
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
