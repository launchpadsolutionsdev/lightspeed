import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiRequest, apiPost, apiPut, apiDelete } from '../../api/client';
import { useToast } from '../../components/common/Toast';
import ToolHeader from '../../components/Layout/ToolHeader';
import Footer from '../../components/Layout/Footer';
import Modal from '../../components/common/Modal';

const CATEGORIES = ['products', 'policies', 'faqs', 'other'];

export default function KnowledgeBasePage() {
  const navigate = useNavigate();
  const showToast = useToast();
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterCategory, setFilterCategory] = useState('all');
  const [showForm, setShowForm] = useState(false);
  const [editingEntry, setEditingEntry] = useState(null);
  const [formData, setFormData] = useState({ title: '', content: '', category: 'products', tags: '' });

  const loadEntries = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (searchQuery) params.set('q', searchQuery);
      if (filterCategory !== 'all') params.set('category', filterCategory);
      const url = searchQuery || filterCategory !== 'all'
        ? `/api/knowledge-base/search?${params}`
        : '/api/knowledge-base';
      const data = await apiRequest(url);
      setEntries(data.entries || []);
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setLoading(false);
    }
  }, [searchQuery, filterCategory, showToast]);

  useEffect(() => {
    loadEntries();
  }, [loadEntries]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      const body = {
        title: formData.title,
        content: formData.content,
        category: formData.category,
        tags: formData.tags ? formData.tags.split(',').map((t) => t.trim()) : [],
      };

      if (editingEntry) {
        await apiPut(`/api/knowledge-base/${editingEntry.id}`, body);
        showToast('Entry updated', 'success');
      } else {
        await apiPost('/api/knowledge-base', body);
        showToast('Entry created', 'success');
      }

      setShowForm(false);
      setEditingEntry(null);
      setFormData({ title: '', content: '', category: 'products', tags: '' });
      loadEntries();
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  const handleEdit = (entry) => {
    setEditingEntry(entry);
    setFormData({
      title: entry.title,
      content: entry.content,
      category: entry.category,
      tags: (entry.tags || []).join(', '),
    });
    setShowForm(true);
  };

  const handleDelete = async (id) => {
    if (!confirm('Delete this entry?')) return;
    try {
      await apiDelete(`/api/knowledge-base/${id}`);
      showToast('Entry deleted', 'success');
      loadEntries();
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  const filteredEntries = entries;

  return (
    <div className="app">
      <ToolHeader title="Knowledge Base">
        <button className="btn-primary" onClick={() => { setEditingEntry(null); setFormData({ title: '', content: '', category: 'products', tags: '' }); setShowForm(true); }}>
          + Add Entry
        </button>
      </ToolHeader>

      <div className="container">
        <div className="knowledge-page">
          <div className="knowledge-toolbar">
            <input
              type="text"
              className="knowledge-search"
              placeholder="Search knowledge base..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            <select
              className="knowledge-filter"
              value={filterCategory}
              onChange={(e) => setFilterCategory(e.target.value)}
            >
              <option value="all">All Categories</option>
              {CATEGORIES.map((cat) => (
                <option key={cat} value={cat}>{cat.charAt(0).toUpperCase() + cat.slice(1)}</option>
              ))}
            </select>
          </div>

          {loading ? (
            <div className="loading-screen"><div className="loading-spinner" /><p>Loading...</p></div>
          ) : filteredEntries.length === 0 ? (
            <div className="empty-state">
              <div className="empty-state-icon">📚</div>
              <h3>No entries yet</h3>
              <p>Add knowledge entries to help the AI generate better responses.</p>
              <button className="btn-primary" onClick={() => setShowForm(true)}>Add Your First Entry</button>
            </div>
          ) : (
            <div className="knowledge-list">
              {filteredEntries.map((entry) => (
                <div key={entry.id} className="knowledge-card">
                  <div className="knowledge-card-header">
                    <h3>{entry.title}</h3>
                    <span className={`knowledge-category-badge category-${entry.category}`}>
                      {entry.category}
                    </span>
                  </div>
                  <p className="knowledge-card-content">{entry.content.substring(0, 200)}{entry.content.length > 200 ? '...' : ''}</p>
                  {entry.tags && entry.tags.length > 0 && (
                    <div className="knowledge-tags">
                      {entry.tags.map((tag, i) => (
                        <span key={i} className="knowledge-tag">{tag}</span>
                      ))}
                    </div>
                  )}
                  <div className="knowledge-card-actions">
                    <button className="btn-sm" onClick={() => handleEdit(entry)}>Edit</button>
                    <button className="btn-sm btn-danger-sm" onClick={() => handleDelete(entry.id)}>Delete</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <Modal show={showForm} onClose={() => setShowForm(false)} className="knowledge-form-modal">
        <h2>{editingEntry ? 'Edit Entry' : 'Add Entry'}</h2>
        <form onSubmit={handleSubmit} className="knowledge-form">
          <div className="form-group">
            <label>Title</label>
            <input
              type="text"
              value={formData.title}
              onChange={(e) => setFormData({ ...formData, title: e.target.value })}
              placeholder="Entry title"
              required
            />
          </div>
          <div className="form-group">
            <label>Category</label>
            <select
              value={formData.category}
              onChange={(e) => setFormData({ ...formData, category: e.target.value })}
            >
              {CATEGORIES.map((cat) => (
                <option key={cat} value={cat}>{cat.charAt(0).toUpperCase() + cat.slice(1)}</option>
              ))}
            </select>
          </div>
          <div className="form-group">
            <label>Content</label>
            <textarea
              value={formData.content}
              onChange={(e) => setFormData({ ...formData, content: e.target.value })}
              placeholder="Knowledge base content..."
              rows={6}
              required
            />
          </div>
          <div className="form-group">
            <label>Tags (comma-separated)</label>
            <input
              type="text"
              value={formData.tags}
              onChange={(e) => setFormData({ ...formData, tags: e.target.value })}
              placeholder="e.g., lottery, 50/50, prizes"
            />
          </div>
          <div className="form-actions">
            <button type="button" className="btn-secondary" onClick={() => setShowForm(false)}>Cancel</button>
            <button type="submit" className="btn-primary">{editingEntry ? 'Update' : 'Create'}</button>
          </div>
        </form>
      </Modal>

      <Footer />
    </div>
  );
}
