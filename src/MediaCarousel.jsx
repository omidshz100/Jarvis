import React, { useState } from 'react';
import ReactPlayer from 'react-player';
import { ChevronLeft, ChevronRight, XCircle } from 'lucide-react';

export function MediaCarousel({ article, onClose }) {
  const [currentIndex, setCurrentIndex] = useState(0);
  
  if (!article) return null;

  const items = [];
  if (article.images && Array.isArray(article.images)) {
    article.images.forEach(img => items.push({ type: 'image', url: img }));
  }
  if (article.youtube_url) {
    items.push({ type: 'video', url: article.youtube_url });
  }

  const handlePrev = (e) => {
    e.stopPropagation();
    setCurrentIndex(i => (i === 0 ? items.length - 1 : i - 1));
  };

  const handleNext = (e) => {
    e.stopPropagation();
    setCurrentIndex(i => (i === items.length - 1 ? 0 : i + 1));
  };

  return (
    <div className="media-carousel-overlay" onClick={onClose} style={{
      position: 'absolute', top: 0, left: 0, width: '100%', height: '100%',
      backgroundColor: 'rgba(0,0,0,0.85)', zIndex: 1000,
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      backdropFilter: 'blur(10px)'
    }}>
      <button 
        onClick={onClose} 
        style={{ position: 'absolute', top: '20px', right: '20px', background: 'none', border: 'none', color: 'white', fontSize: '2rem', cursor: 'pointer', zIndex: 1001, transition: 'transform 0.2s' }}
        onMouseEnter={e => e.currentTarget.style.transform = 'scale(1.1)'}
        onMouseLeave={e => e.currentTarget.style.transform = 'scale(1)'}
      >
        <XCircle size={32} />
      </button>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%', padding: '0 10px' }}>
        {items.length > 1 && (
          <button onClick={handlePrev} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.7)', cursor: 'pointer', padding: '0 20px', transition: 'color 0.2s', display: 'flex', alignItems: 'center' }} onMouseEnter={e => e.currentTarget.style.color = 'white'} onMouseLeave={e => e.currentTarget.style.color = 'rgba(255,255,255,0.7)'}>
            <ChevronLeft size={64} />
          </button>
        )}

        <div className="carousel-content" onClick={e => e.stopPropagation()} style={{ flex: 1, maxWidth: '80%', height: '70vh', position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: '#000', borderRadius: '16px', overflow: 'hidden', boxShadow: '0 20px 50px rgba(0,0,0,0.5)' }}>
            {items.length === 0 ? (
              <p style={{color:'white', opacity: 0.5}}>No media available.</p>
            ) : items[currentIndex].type === 'image' ? (
              <img src={`http://localhost:3000${items[currentIndex].url}`} alt="Media" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
            ) : (() => {
              const url = items[currentIndex].url ? items[currentIndex].url.trim() : '';
              const match = url.match(/^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|\&v=)([^#\&\?]*).*/);
              const videoId = (match && match[2].length === 11) ? match[2] : null;
              
              if (!videoId) {
                return <div style={{ color: '#ff4757', padding: '20px' }}>Error: Invalid YouTube URL format.</div>;
              }

              return (
                <iframe
                  width="100%"
                  height="100%"
                  src={`https://www.youtube.com/embed/${videoId}?autoplay=1&enablejsapi=1`}
                  frameBorder="0"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                  allowFullScreen
                  style={{ border: 'none', background: 'black' }}
                />
              );
            })()}
          </div>
        </div>

        {items.length > 1 && (
          <button onClick={handleNext} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.7)', cursor: 'pointer', padding: '0 20px', transition: 'color 0.2s', display: 'flex', alignItems: 'center' }} onMouseEnter={e => e.currentTarget.style.color = 'white'} onMouseLeave={e => e.currentTarget.style.color = 'rgba(255,255,255,0.7)'}>
            <ChevronRight size={64} />
          </button>
        )}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginTop: '24px', gap: '12px' }}>
        {items.length > 1 && (
          <div style={{ display: 'flex', gap: '12px' }}>
            {items.map((_, idx) => (
              <div key={idx} onClick={(e) => { e.stopPropagation(); setCurrentIndex(idx); }} style={{ width: '10px', height: '10px', borderRadius: '50%', backgroundColor: idx === currentIndex ? 'white' : 'rgba(255,255,255,0.3)', cursor: 'pointer', transition: 'all 0.3s' }} />
            ))}
          </div>
        )}
        
        <h2 style={{ color: 'white', fontWeight: 500, letterSpacing: '1px', fontSize: '1.2rem', margin: 0, textAlign: 'center' }}>
          {article.title}
        </h2>
      </div>
    </div>
  );
}
