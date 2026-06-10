import Navbar from './components/Navbar';
import CustomCursor from './components/CustomCursor';
import MouseSpotlight from './components/MouseSpotlight';
import Home from './pages/Home';
import Footer from './components/Footer';

export default function App() {
  return (
    <>
      <CustomCursor />
      <MouseSpotlight />
      <Navbar />
      <main>
        <Home />
      </main>
      <Footer />
    </>
  );
}
