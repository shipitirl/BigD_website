'use client';

import { useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';

// ----------------------
// TYPES
// ----------------------
interface Lead {
  lead_id: string;
  status: string;
  service_type: string | null;
  tree_count: number | null;
  dimensions: { height_ft: number | null; diameter_ft: number | null };
  access: { location: string | null; gate_width_ft: number | null; slope: string | null };
  hazards: { power_lines: boolean | null; structures_nearby: boolean | null };
  zip: string | null;
  contact: { name: string | null; phone: string | null; email: string | null };
  photos: { urls: string[]; count: number };
  estimate: { min: number; max: number; confidence: string; drivers: string[] } | null;
  urgency: string;
}

// ----------------------
// STYLES
// ----------------------
const styles = {
  container: {
    maxWidth: '800px',
    margin: '0 auto',
    padding: '24px',
    fontFamily: 'system-ui, sans-serif',
  },
  header: {
    background: 'linear-gradient(135deg, #2d5016 0%, #4a7c23 100%)',
    color: 'white',
    padding: '24px',
    borderRadius: '12px',
    marginBottom: '24px',
  },
  card: {
    background: 'white',
    padding: '20px',
    borderRadius: '12px',
    boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
    marginBottom: '16px',
  },
  label: {
    fontWeight: 'bold' as const,
    color: '#666',
    fontSize: '12px',
    textTransform: 'uppercase' as const,
    marginBottom: '4px',
  },
  estimateBox: {
    background: '#f0f7e6',
    padding: '20px',
    borderRadius: '12px',
    borderLeft: '4px solid #4a7c23',
    marginBottom: '24px',
  },
  estimateRange: {
    fontSize: '32px',
    fontWeight: 'bold' as const,
    color: '#2d5016',
  },
  button: {
    display: 'inline-block',
    padding: '14px 28px',
    fontSize: '16px',
    fontWeight: 'bold' as const,
    border: 'none',
    borderRadius: '8px',
    cursor: 'pointer',
    marginRight: '12px',
    marginTop: '8px',
  },
  primaryBtn: {
    background: '#4a7c23',
    color: 'white',
  },
  secondaryBtn: {
    background: '#6c757d',
    color: 'white',
  },
  input: {
    padding: '10px 14px',
    fontSize: '16px',
    border: '1px solid #ddd',
    borderRadius: '8px',
    width: '120px',
    marginRight: '8px',
  },
  photoGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))',
    gap: '12px',
  },
  photo: {
    width: '100%',
    height: '150px',
    objectFit: 'cover' as const,
    borderRadius: '8px',
  },
  statusBadge: {
    display: 'inline-block',
    padding: '4px 12px',
    borderRadius: '20px',
    fontSize: '12px',
    fontWeight: 'bold' as const,
  },
};

// ----------------------
// SERVICE LABELS
// ----------------------
const serviceLabels: Record<string, string> = {
  stump_grinding: 'Stump Grinding',
  tree_removal: 'Tree Removal',
  trimming: 'Tree Trimming',
  cleanup: 'Debris Cleanup',
};

// ----------------------
// COMPONENT
// ----------------------
export default function LeadPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const leadId = (params?.id as string) || '';
  const showAdjust = searchParams?.get('adjust') === 'true';

  const [lead, setLead] = useState<Lead | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [adjustMode, setAdjustMode] = useState(showAdjust);
  const [adjustMin, setAdjustMin] = useState('');
  const [adjustMax, setAdjustMax] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    fetchLead();
  }, [leadId]);

  async function fetchLead() {
    try {
      const res = await fetch(`/api/lead/${leadId}`);
      if (!res.ok) throw new Error('Lead not found');
      const data = await res.json();
      setLead(data.lead);
      if (data.lead.estimate) {
        setAdjustMin(data.lead.estimate.min.toString());
        setAdjustMax(data.lead.estimate.max.toString());
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function handleApprove() {
    setSubmitting(true);
    try {
      const res = await fetch(`/api/lead/${leadId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'approve' }),
      });
      const data = await res.json();
      if (data.success) {
        setSuccess('Approved! SMS sent to customer.');
        setLead(prev => prev ? { ...prev, status: 'approved' } : null);
      }
    } catch (err) {
      setError('Failed to approve');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleAdjust() {
    setSubmitting(true);
    try {
      const res = await fetch(`/api/lead/${leadId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'adjust',
          adjusted_min: parseInt(adjustMin),
          adjusted_max: parseInt(adjustMax),
        }),
      });
      const data = await res.json();
      if (data.success) {
        setSuccess('Adjusted and approved! SMS sent to customer.');
        setLead(prev => prev ? { ...prev, status: 'approved', estimate: data.estimate } : null);
        setAdjustMode(false);
      }
    } catch (err) {
      setError('Failed to adjust');
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return <div style={styles.container}>Loading...</div>;
  }

  if (error || !lead) {
    return <div style={styles.container}>Error: {error || 'Lead not found'}</div>;
  }

  const statusColors: Record<string, string> = {
    collecting: '#ffc107',
    ready_for_estimate: '#17a2b8',
    awaiting_owner: '#6c757d',
    approved: '#28a745',
    scheduled: '#007bff',
  };

  return (
    <div style={{ ...styles.container, background: '#f5f5f5', minHeight: '100vh' }}>
      <div style={styles.header}>
        <h1 style={{ margin: 0 }}>🌳 Lead Review</h1>
        <p style={{ margin: '8px 0 0', opacity: 0.9 }}>
          {serviceLabels[lead.service_type || ''] || 'Tree Service'} — {lead.zip || 'Unknown ZIP'}
        </p>
        <span style={{
          ...styles.statusBadge,
          background: statusColors[lead.status] || '#6c757d',
          color: 'white',
          marginTop: '12px',
        }}>
          {lead.status.replace(/_/g, ' ').toUpperCase()}
        </span>
      </div>

      {success && (
        <div style={{ ...styles.card, background: '#d4edda', borderLeft: '4px solid #28a745' }}>
          ✅ {success}
        </div>
      )}

      {lead.urgency === 'emergency' && (
        <div style={{ ...styles.card, background: '#f8d7da', borderLeft: '4px solid #dc3545' }}>
          🚨 <strong>EMERGENCY REQUEST</strong>
        </div>
      )}

      <div style={styles.estimateBox}>
        <div style={styles.label}>Estimate</div>
        {adjustMode ? (
          <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ marginRight: '8px' }}>$</span>
            <input
              type="number"
              value={adjustMin}
              onChange={(e) => setAdjustMin(e.target.value)}
              style={styles.input}
              placeholder="Min"
            />
            <span style={{ margin: '0 8px' }}>—</span>
            <span style={{ marginRight: '8px' }}>$</span>
            <input
              type="number"
              value={adjustMax}
              onChange={(e) => setAdjustMax(e.target.value)}
              style={styles.input}
              placeholder="Max"
            />
          </div>
        ) : (
          <div style={styles.estimateRange}>
            ${lead.estimate?.min.toLocaleString()} — ${lead.estimate?.max.toLocaleString()}
          </div>
        )}
        <div style={{ color: '#666', marginTop: '4px' }}>
          {lead.estimate?.confidence} confidence
        </div>
        {lead.estimate?.drivers.length ? (
          <ul style={{ margin: '12px 0 0', paddingLeft: '20px', color: '#666' }}>
            {lead.estimate.drivers.map((d, i) => <li key={i}>{d}</li>)}
          </ul>
        ) : null}
      </div>

      <div style={styles.card}>
        <div style={styles.label}>Service Details</div>
        <p><strong>{serviceLabels[lead.service_type || ''] || 'Unknown'}</strong> — {lead.tree_count || 1} item(s)</p>
        <p>
          {lead.access.location === 'backyard' ? '🏠 Backyard' : '🏡 Front yard'}
          {lead.access.gate_width_ft ? ` • Gate: ${lead.access.gate_width_ft}ft` : ''}
          {lead.access.slope === 'steep' ? ' • ⚠️ Steep' : ''}
        </p>
        <p>
          {lead.hazards.power_lines ? '⚡ Power lines' : '✓ No power lines'}
          {lead.hazards.structures_nearby ? ' • 🏗️ Near structure' : ''}
        </p>
      </div>

      <div style={styles.card}>
        <div style={styles.label}>Customer</div>
        <p style={{ fontSize: '18px', fontWeight: 'bold' }}>{lead.contact.name || 'Unknown'}</p>
        <p>📞 <a href={`tel:${lead.contact.phone}`}>{lead.contact.phone || 'No phone'}</a></p>
        {lead.contact.email && <p>✉️ {lead.contact.email}</p>}
      </div>

      {lead.photos.count > 0 && (
        <div style={styles.card}>
          <div style={styles.label}>Photos ({lead.photos.count})</div>
          <div style={styles.photoGrid}>
            {lead.photos.urls.map((url, i) => (
              <a key={i} href={url} target="_blank" rel="noopener noreferrer">
                <img src={url} alt={`Photo ${i + 1}`} style={styles.photo} />
              </a>
            ))}
          </div>
        </div>
      )}

      {lead.status !== 'approved' && lead.status !== 'scheduled' && (
        <div style={{ marginTop: '24px' }}>
          {adjustMode ? (
            <>
              <button
                style={{ ...styles.button, ...styles.primaryBtn }}
                onClick={handleAdjust}
                disabled={submitting}
              >
                {submitting ? 'Sending...' : '✅ Save & Send to Customer'}
              </button>
              <button
                style={{ ...styles.button, ...styles.secondaryBtn }}
                onClick={() => setAdjustMode(false)}
              >
                Cancel
              </button>
            </>
          ) : (
            <>
              <button
                style={{ ...styles.button, ...styles.primaryBtn }}
                onClick={handleApprove}
                disabled={submitting}
              >
                {submitting ? 'Sending...' : '✅ Approve & Send to Customer'}
              </button>
              <button
                style={{ ...styles.button, ...styles.secondaryBtn }}
                onClick={() => setAdjustMode(true)}
              >
                ✏️ Adjust Estimate
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
