import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { Link, Navigate, NavLink, Route, Routes, useNavigate } from 'react-router-dom';
import { api, type Catalog, type User } from './lib/api';
import { Spinner } from './components/ui';
import { LoginPage } from './pages/Login';
import { StorePage } from './pages/Store';
import { WizardPage } from './pages/Wizard';
import { PrewarmedPage } from './pages/Prewarmed';
import { OrdersPage, OrderDetailPage } from './pages/Orders';
import { AdminPage } from './pages/Admin';

interface Ctx { user: User | null; catalog: Catalog | null; refreshCatalog: () => Promise<void>; setUser: (u: User | null) => void }
const AppCtx = createContext<Ctx>({ user: null, catalog: null, refreshCatalog: async () => {}, setUser: () => {} });
export const useApp = () => useContext(AppCtx);

export function App() {
  const [user, setUser] = useState<User | null>(null);
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [loading, setLoading] = useState(true);

  const refreshCatalog = useCallback(async () => {
    try { setCatalog(await api<Catalog>('/catalog')); } catch { setCatalog(null); }
  }, []);

  useEffect(() => {
    api<{ user: User | null }>('/auth/me').then((r) => setUser(r.user)).finally(() => setLoading(false));
  }, []);
  useEffect(() => { if (user) refreshCatalog(); }, [user, refreshCatalog]);

  if (loading) return <div className="page"><Spinner label="Loading…" /></div>;
  if (!user) return <AppCtx.Provider value={{ user, catalog, refreshCatalog, setUser }}><LoginPage /></AppCtx.Provider>;

  return (
    <AppCtx.Provider value={{ user, catalog, refreshCatalog, setUser }}>
      <Shell>
        <Routes>
          <Route path="/" element={<Navigate to="/store" replace />} />
          <Route path="/store" element={<StorePage />} />
          <Route path="/store/order/:id" element={<WizardPage />} />
          <Route path="/store/prewarmed/:id" element={<PrewarmedPage />} />
          <Route path="/orders" element={<OrdersPage />} />
          <Route path="/orders/:id" element={<OrderDetailPage />} />
          <Route path="/admin/*" element={user.role === 'admin' ? <AdminPage /> : <Navigate to="/store" replace />} />
          <Route path="*" element={<div className="page"><div className="empty"><h2>Page not found</h2><p><Link to="/store">Back to the store</Link></p></div></div>} />
        </Routes>
      </Shell>
    </AppCtx.Provider>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  const { user, catalog, setUser } = useApp();
  const nav = useNavigate();
  const logout = async () => { await api('/auth/logout', { method: 'POST' }); setUser(null); nav('/'); };
  return (
    <>
      {catalog?.environment.mode === 'mock' && (
        <div className="test-banner"><b>Test mode.</b> Vendors are simulated and nothing is purchased. Payments use a simulated checkout.</div>
      )}
      <header className="topbar">
        <div className="topbar-inner">
          <Link to="/store" className="logo" style={{ textDecoration: 'none' }}><span className="logo-mark">☁</span><span className="logo-text">Cloudlead</span></Link>
          <nav className="nav">
            <NavLink to="/store">Buy infrastructure</NavLink>
            <NavLink to="/orders">My orders</NavLink>
            {user?.role === 'admin' && <NavLink to="/admin">Admin</NavLink>}
          </nav>
          <div className="user-chip">
            <span className="who">{user?.name}</span>
            <button className="btn btn-ghost btn-sm" onClick={logout}>Sign out</button>
          </div>
        </div>
      </header>
      {children}
    </>
  );
}
