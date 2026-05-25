import React, { useState, useEffect } from 'react';
import { generateEmbedding } from './llmService';

export function KnowledgeBase({ config }) {
  const [articles, setArticles] = useState([]);
  const [loading, setLoading] = useState(true);
  
  // form state
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [youtubeUrl, setYoutubeUrl] = useState('');
  const [images, setImages] = useState([]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    fetchArticles();
  }, []);

  const fetchArticles = async () => {
    try {
      const res = await fetch('http://localhost:3000/api/articles');
      const data = await res.json();
      setArticles(data);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!title || !content) return;
    
    setIsSubmitting(true);
    try {
      // 1. Generate Vector Embedding using the frontend's API key
      const embedding = await generateEmbedding(`Title: ${title}\nContent: ${content}`, config);
      
      // 2. Submit form data
      const formData = new FormData();
      formData.append('title', title);
      formData.append('content', content);
      formData.append('youtube_url', youtubeUrl);
      formData.append('embedding_json', JSON.stringify(embedding));
      
      for (let i = 0; i < images.length; i++) {
        formData.append('images', images[i]);
      }

      const res = await fetch('http://localhost:3000/api/articles', {
        method: 'POST',
        body: formData
      });
      
      if (res.ok) {
        setTitle('');
        setContent('');
        setYoutubeUrl('');
        setImages([]);
        // Reset file input via a hack or user can just ignore it
        document.getElementById('image-upload-input').value = "";
        fetchArticles();
      }
    } catch (e) {
      console.error(e);
      alert("Failed to save article. Make sure your Gemini API key is configured in System Preferences.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async (id) => {
    await fetch(`http://localhost:3000/api/articles/${id}`, { method: 'DELETE' });
    fetchArticles();
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '32px' }}>
      
      {/* ADD NEW ARTICLE FORM */}
      <div style={{ backgroundColor: 'rgba(255,255,255,0.02)', padding: '24px', borderRadius: '16px', border: '1px solid rgba(255,255,255,0.05)' }}>
        <h4 style={{ marginBottom: '24px', fontSize: '1.2rem', color: '#00d2ff' }}><i className="bi bi-file-earmark-plus"></i> Add New Article</h4>
        
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          
          <div className="form-group">
            <label>Title <span style={{color: '#ff4757'}}>*</span></label>
            <input 
              type="text" 
              className="glass-input" 
              value={title} 
              onChange={e => setTitle(e.target.value)} 
              required 
              placeholder="e.g. AGROTECH Project" 
              style={{ backgroundColor: 'rgba(255,255,255,0.03)' }}
            />
          </div>
          
          <div className="form-group">
            <label>Text Content <span style={{color: '#ff4757'}}>*</span></label>
            <textarea 
              className="glass-input" 
              rows="6" 
              value={content} 
              onChange={e => setContent(e.target.value)} 
              required 
              placeholder="Paste the full article here..."
              style={{ resize: 'vertical', backgroundColor: 'rgba(255,255,255,0.03)', lineHeight: '1.5' }}
            ></textarea>
          </div>
          
          <div className="form-group">
            <label>YouTube Video URL <span style={{ opacity: 0.5 }}>(Optional)</span></label>
            <input 
              type="url" 
              className="glass-input" 
              value={youtubeUrl} 
              onChange={e => setYoutubeUrl(e.target.value)} 
              placeholder="https://youtube.com/..." 
              style={{ backgroundColor: 'rgba(255,255,255,0.03)' }}
            />
          </div>
          
          <div className="form-group">
            <label>Images <span style={{ opacity: 0.5 }}>(Optional)</span></label>
            <input 
              id="image-upload-input"
              type="file" 
              className="glass-input" 
              multiple 
              accept="image/*" 
              onChange={e => setImages(e.target.files)} 
              style={{ padding: '12px', backgroundColor: 'rgba(255,255,255,0.03)' }}
            />
          </div>
          
          <div style={{ marginTop: '8px' }}>
            <button type="submit" className="glass-button primary" style={{ width: '100%', justifyContent: 'center' }} disabled={isSubmitting}>
              {isSubmitting ? (
                <span><i className="bi bi-hourglass-split me-2"></i> Compressing Vector & Saving...</span>
              ) : (
                <span><i className="bi bi-cloud-arrow-up me-2"></i> Save to Brain</span>
              )}
            </button>
          </div>
          
        </form>
      </div>

      {/* SAVED ARTICLES LIST */}
      <div>
        <h4 style={{ marginBottom: '16px', fontSize: '1.2rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <i className="bi bi-journal-bookmark"></i> Saved Articles
        </h4>
        
        {loading ? (
          <div style={{ padding: '20px', textAlign: 'center', opacity: 0.5 }}>Loading database...</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {articles.length === 0 && (
              <div style={{ padding: '30px', textAlign: 'center', opacity: 0.4, border: '1px dashed rgba(255,255,255,0.1)', borderRadius: '12px' }}>
                <i className="bi bi-inbox" style={{ fontSize: '2rem', marginBottom: '10px', display: 'block' }}></i>
                No articles added yet. Feed me data!
              </div>
            )}
            
            {articles.map(article => (
              <div key={article.id} style={{ 
                backgroundColor: 'rgba(0,0,0,0.3)', 
                border: '1px solid rgba(255,255,255,0.05)', 
                padding: '20px', 
                borderRadius: '16px',
                transition: 'transform 0.2s',
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '12px' }}>
                  <h5 style={{ margin: 0, color: '#fff', fontSize: '1.1rem', lineHeight: '1.3' }}>{article.title}</h5>
                  <button onClick={() => handleDelete(article.id)} className="glass-button" style={{ color: '#ff4757', borderColor: 'rgba(255,71,87,0.3)', padding: '6px 12px', fontSize: '0.85rem' }}>
                    <i className="bi bi-trash"></i>
                  </button>
                </div>
                
                <p style={{ opacity: 0.6, fontSize: '0.9rem', display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden', lineHeight: '1.5', margin: '0 0 16px 0' }}>
                  {article.content}
                </p>
                
                <div style={{ display: 'flex', gap: '16px', fontSize: '0.8rem', opacity: 0.7 }}>
                  <span style={{ backgroundColor: 'rgba(255,255,255,0.1)', padding: '4px 8px', borderRadius: '6px' }}>
                    <i className="bi bi-hash"></i> {article.id}
                  </span>
                  
                  {article.images && article.images.length > 0 && (
                    <span style={{ backgroundColor: 'rgba(255,255,255,0.1)', padding: '4px 8px', borderRadius: '6px', color: '#00d2ff' }}>
                      <i className="bi bi-images"></i> {article.images.length} Images
                    </span>
                  )}
                  
                  {article.youtube_url && (
                    <span style={{ backgroundColor: 'rgba(255,255,255,0.1)', padding: '4px 8px', borderRadius: '6px', color: '#ff4757' }}>
                      <i className="bi bi-youtube"></i> Video
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
