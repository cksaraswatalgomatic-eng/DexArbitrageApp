import { Link } from 'react-router-dom';

export default function Navbar() {
  return (
    <nav style={{ display: 'flex', gap: '1rem', padding: '1rem', backgroundColor: '#eee' }}>
      <Link to="/">Dashboard</Link>
      <Link to="/trades">Trades</Link>
    </nav>
  );
}
