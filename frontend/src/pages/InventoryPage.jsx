import { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';

export default function InventoryPage() {
  const { profile, apiCall } = useAuth();
  const [items, setItems] = useState([]);
  const [itemName, setItemName] = useState('');
  const [quantity, setQuantity] = useState('');
  const [threshold, setThreshold] = useState('');
  const [editingItem, setEditingItem] = useState(null);
  const [editQty, setEditQty] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    if (profile?.orgId) loadInventory();
  }, [profile]);

  async function loadInventory() {
    try {
      const data = await apiCall(`/organizations/${profile.orgId}/inventory`);
      setItems(data.items || []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleAdd(e) {
    e.preventDefault();
    setError('');
    setAdding(true);

    try {
      const body = { itemName, quantity: parseInt(quantity) || 0 };
      if (threshold) body.lowStockThreshold = parseInt(threshold);
      await apiCall(`/organizations/${profile.orgId}/inventory`, {
        method: 'POST',
        body: JSON.stringify(body)
      });
      setItemName('');
      setQuantity('');
      setThreshold('');
      loadInventory();
    } catch (err) {
      setError(err.message);
    } finally {
      setAdding(false);
    }
  }

  async function handleUpdate(itemId) {
    try {
      await apiCall(`/organizations/${profile.orgId}/inventory/${itemId}`, {
        method: 'PUT',
        body: JSON.stringify({ quantity: parseInt(editQty) })
      });
      setEditingItem(null);
      loadInventory();
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleDelete(itemId) {
    if (!confirm('Delete this item?')) return;
    try {
      await apiCall(`/organizations/${profile.orgId}/inventory/${itemId}`, {
        method: 'DELETE'
      });
      loadInventory();
    } catch (err) {
      setError(err.message);
    }
  }

  const alertItems = items.filter(i => i.alertStatus !== 'ok');

  if (loading) {
    return <div className="page"><div className="spinner" /></div>;
  }

  return (
    <div className="page">
      <div className="page-header">
        <h1>Inventory</h1>
        <p className="subtitle">{items.length} item{items.length !== 1 ? 's' : ''} tracked</p>
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      {alertItems.length > 0 && (
        <div className="alert alert-warning">
          <strong>Stock Alerts:</strong> {alertItems.length} item{alertItems.length !== 1 ? 's' : ''} need attention
        </div>
      )}

      <div className="card">
        <h3>Add Item</h3>
        <form onSubmit={handleAdd} className="inline-form">
          <input
            type="text"
            value={itemName}
            onChange={e => setItemName(e.target.value)}
            placeholder="Item name"
            required
          />
          <input
            type="number"
            value={quantity}
            onChange={e => setQuantity(e.target.value)}
            placeholder="Quantity"
            min="0"
            required
          />
          <input
            type="number"
            value={threshold}
            onChange={e => setThreshold(e.target.value)}
            placeholder="Low stock alert at (default: 5)"
            min="0"
          />
          <button type="submit" className="btn btn-primary" disabled={adding}>
            {adding ? 'Adding...' : 'Add Item'}
          </button>
        </form>
      </div>

      <div className="card">
        <h3>Items</h3>
        <table className="data-table">
          <thead>
            <tr>
              <th>Item</th>
              <th>Quantity</th>
              <th>Status</th>
              <th>Last Updated By</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {items.map(item => (
              <tr key={item.itemId} className={item.alertStatus !== 'ok' ? 'row-alert' : ''}>
                <td>{item.itemName}</td>
                <td>
                  {editingItem === item.itemId ? (
                    <div className="edit-qty">
                      <input
                        type="number"
                        value={editQty}
                        onChange={e => setEditQty(e.target.value)}
                        min="0"
                        autoFocus
                      />
                      <button className="btn btn-small btn-primary" onClick={() => handleUpdate(item.itemId)}>Save</button>
                      <button className="btn btn-small" onClick={() => setEditingItem(null)}>Cancel</button>
                    </div>
                  ) : (
                    <span
                      className="qty-click"
                      onClick={() => { setEditingItem(item.itemId); setEditQty(String(item.quantity)); }}
                    >
                      {item.quantity}
                    </span>
                  )}
                </td>
                <td>
                  {item.alertStatus === 'out_of_stock' && <span className="badge badge-danger">Out of Stock</span>}
                  {item.alertStatus === 'low_stock' && <span className="badge badge-warning">Low Stock</span>}
                  {item.alertStatus === 'ok' && <span className="badge badge-success">OK</span>}
                </td>
                <td className="text-muted">{item.updatedBy || '-'}</td>
                <td>
                  <button className="btn btn-danger btn-small" onClick={() => handleDelete(item.itemId)}>Delete</button>
                </td>
              </tr>
            ))}
            {items.length === 0 && (
              <tr><td colSpan="5" className="empty-state">No items yet. Add one above.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
