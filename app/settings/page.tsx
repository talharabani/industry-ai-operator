'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { AppLayout } from '@/components/AppLayout';
import {
  BusinessRecord,
  BusinessSettings,
  IndustryType,
  FaqItem,
  ProductServiceItem,
  OrderRecord,
} from '@/lib/types';
import {
  Store,
  Mail,
  Save,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Plus,
  Trash2,
  ShieldCheck,
  ChevronDown,
  ChevronUp,
  Terminal,
  RefreshCw,
  Package,
  Edit2,
  Tag,
  Check,
  X,
  ShoppingBag,
  Link2,
  ExternalLink,
  Layers,
  Globe,
  Clock,
  Bell,
  HelpCircle,
  Database,
  Key,
} from 'lucide-react';

const TIMEZONE_OPTIONS = [
  { value: 'Europe/Amsterdam', label: 'Europe/Amsterdam (CET/CEST, UTC+1)' },
  { value: 'Asia/Karachi', label: 'Asia/Karachi (PKT, UTC+5)' },
  { value: 'UTC', label: 'UTC (Coordinated Universal Time)' },
  { value: 'America/New_York', label: 'America/New_York (EST, UTC-5)' },
  { value: 'Europe/London', label: 'Europe/London (GMT/BST, UTC+0)' },
  { value: 'Asia/Dubai', label: 'Asia/Dubai (GST, UTC+4)' },
];

const CURRENCY_OPTIONS = [
  { value: 'PKR', label: 'PKR - Pakistani Rupee (Rs)' },
  { value: 'USD', label: 'USD - US Dollar ($)' },
  { value: 'EUR', label: 'EUR - Euro (€)' },
  { value: 'GBP', label: 'GBP - British Pound (£)' },
  { value: 'AED', label: 'AED - UAE Dirham (د.إ)' },
];

export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState<'behavior' | 'order_issues' | 'profile' | 'integrations' | 'email' | 'knowledge' | 'demo_orders'>('behavior');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Business Context State
  const [tenantId, setTenantId] = useState('demo-store');
  const [approverId, setApproverId] = useState('owner-demo');
  const [businessRecord, setBusinessRecord] = useState<BusinessRecord | null>(null);

  // 1. Profile State
  const [businessName, setBusinessName] = useState('Demo Clothing Store');
  const [industry, setIndustry] = useState<IndustryType>('ecommerce');
  const [country, setCountry] = useState('Pakistan');
  const [timezone, setTimezone] = useState('Asia/Karachi');
  const [currency, setCurrency] = useState('PKR');
  const [supportEmail, setSupportEmail] = useState('support@demo-store.com');
  const [startTime, setStartTime] = useState('09:00');
  const [endTime, setEndTime] = useState('18:00');
  const [activeDays, setActiveDays] = useState<string[]>(['mon', 'tue', 'wed', 'thu', 'fri']);

  // 2. Automation Mode & Behavior
  const [automationMode, setAutomationMode] = useState<'auto_routine' | 'draft_only' | 'paused'>('auto_routine');

  // 3. Shopify Store Integration State
  const [shopifyConnected, setShopifyConnected] = useState(false);
  const [shopifyDomain, setShopifyDomain] = useState('');
  const [shopifyName, setShopifyName] = useState('');
  const [shopifyCurrency, setShopifyCurrency] = useState('PKR');
  const [shopifyPlan, setShopifyPlan] = useState('Standard');
  const [shopifySyncStatus, setShopifySyncStatus] = useState<string>('idle');
  const [shopifyLastSyncedAt, setShopifyLastSyncedAt] = useState<string | null>(null);
  const [shopifyLastError, setShopifyLastError] = useState<string | null>(null);
  const [shopifyProductCount, setShopifyProductCount] = useState(0);
  const [shopifyOrderCount, setShopifyOrderCount] = useState(0);
  const [shopifyConfiguredOnPlatform, setShopifyConfiguredOnPlatform] = useState(true);
  const [connectShopInput, setConnectShopInput] = useState('');
  const [connectingShopify, setConnectingShopify] = useState(false);
  const [syncingShopify, setSyncingShopify] = useState(false);
  const [disconnectingShopify, setDisconnectingShopify] = useState(false);

  // 3b. Custom Store Integration State
  const [customStoreConnected, setCustomStoreConnected] = useState(false);
  const [customStoreName, setCustomStoreName] = useState('');
  const [customStoreWebsite, setCustomStoreWebsite] = useState('');
  const [customStoreApiUrl, setCustomStoreApiUrl] = useState('');
  const [customStoreApiKey, setCustomStoreApiKey] = useState('');
  const [customStoreMaskedKey, setCustomStoreMaskedKey] = useState('');
  const [customStoreWebhookSecret, setCustomStoreWebhookSecret] = useState('');
  const [customStoreSyncStatus, setCustomStoreSyncStatus] = useState<string>('idle');
  const [customStoreLastSyncedAt, setCustomStoreLastSyncedAt] = useState<string | null>(null);
  const [customStoreLastError, setCustomStoreLastError] = useState<string | null>(null);
  const [customStoreProductCount, setCustomStoreProductCount] = useState(0);
  const [customStoreOrderCount, setCustomStoreOrderCount] = useState(0);
  const [testingCustomStore, setTestingCustomStore] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string; latency_ms?: number } | null>(null);
  const [savingCustomStore, setSavingCustomStore] = useState(false);
  const [syncingCustomStore, setSyncingCustomStore] = useState(false);
  const [disconnectingCustomStore, setDisconnectingCustomStore] = useState(false);

  // 4. Gmail & Email Connection
  const [gmailConnected, setGmailConnected] = useState(false);
  const [gmailEmail, setGmailEmail] = useState('');
  const [gmailName, setGmailName] = useState('');
  const [syncingGmail, setSyncingGmail] = useState(false);

  // 5. Knowledge & Catalog
  const [faqs, setFaqs] = useState<FaqItem[]>([]);
  const [products, setProducts] = useState<ProductServiceItem[]>([]);
  const [returnWindowDays, setReturnWindowDays] = useState<number>(14);
  const [shippingTimeframe, setShippingTimeframe] = useState<string>('Standard delivery takes 2-4 business days.');

  // Order Issue Resolution & Follow-up Settings
  const [followupIntervalHours, setFollowupIntervalHours] = useState<number>(24);
  const [clarificationHours, setClarificationHours] = useState<number>(24);
  const [carrierCheckHours, setCarrierCheckHours] = useState<number>(6);
  const [maxFollowupAttempts, setMaxFollowupAttempts] = useState<number>(2);
  const [autoEscalateToOwner, setAutoEscalateToOwner] = useState<boolean>(true);
  const [ownerReminderHours, setOwnerReminderHours] = useState<number>(24);
  const [autoCloseResolvedDays, setAutoCloseResolvedDays] = useState<number>(7);

  // 5. Demo Orders State
  const [orders, setOrders] = useState<OrderRecord[]>([]);
  const [loadingOrders, setLoadingOrders] = useState(false);
  const [orderModalOpen, setOrderModalOpen] = useState(false);
  const [editingOrder, setEditingOrder] = useState<OrderRecord | null>(null);
  const [orderForm, setOrderForm] = useState({
    order_id: '',
    customer_name: '',
    customer_email: '',
    product_name: '',
    variant: '',
    quantity: 1,
    unit_price: 2500,
    total: 2500,
    currency: 'PKR',
    status: 'shipped',
    tracking_number: '',
  });
  const [orderSaving, setOrderSaving] = useState(false);
  const [orderMessage, setOrderMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Advanced section disclosure
  const [advancedOpen, setAdvancedOpen] = useState(false);

  const fetchSettings = useCallback(async () => {
    try {
      const res = await fetch('/api/business', { cache: 'no-store' });
      if (res.ok) {
        const data = await res.json();
        setTenantId(data.tenant_id);
        setApproverId(data.approver_id);
        if (data.business) {
          setBusinessRecord(data.business);
          const s: BusinessSettings = data.business.settings;
          if (s) {
            setBusinessName(s.business_name || 'Demo Clothing Store');
            setIndustry(s.industry || 'ecommerce');
            setCountry(s.country || 'Pakistan');
            setTimezone(s.timezone || 'Asia/Karachi');
            setCurrency(s.currency || 'PKR');
            setSupportEmail(s.connections?.email?.sender_email || 'support@demo-store.com');
            if (s.working_hours) {
              setStartTime(s.working_hours.start_time || '09:00');
              setEndTime(s.working_hours.end_time || '18:00');
              setActiveDays(s.working_hours.days || ['mon', 'tue', 'wed', 'thu', 'fri']);
            }
            setAutomationMode(s.automation_mode || 'auto_routine');

            if (s.order_issues_config) {
              setFollowupIntervalHours(s.order_issues_config.followup_interval_hours ?? 24);
              setClarificationHours(Math.round((s.order_issues_config.clarification_delay_minutes || 1440) / 60));
              setCarrierCheckHours(Math.round((s.order_issues_config.carrier_check_interval_minutes || 360) / 60));
              setMaxFollowupAttempts(s.order_issues_config.max_followup_attempts ?? 2);
              setAutoEscalateToOwner(s.order_issues_config.auto_escalate_to_owner ?? true);
              setOwnerReminderHours(Math.round((s.order_issues_config.owner_reminder_interval_minutes || 1440) / 60));
              setAutoCloseResolvedDays(s.order_issues_config.auto_close_resolved_days ?? 7);
            }

            if (s.knowledge) {
              setFaqs(s.knowledge.faqs || []);
              setProducts(s.knowledge.products_services || []);
              if (s.knowledge.policies) {
                setReturnWindowDays(s.knowledge.policies.return_window_days ?? s.return_window_days ?? 14);
                setShippingTimeframe(s.knowledge.policies.shipping_timeframe || 'Standard delivery takes 2-4 business days.');
              }
            } else if (s.return_window_days) {
              setReturnWindowDays(s.return_window_days);
            }
          }
        }
      }

      // Fetch Gmail connection status
      const gmailRes = await fetch('/api/business/connections/gmail', { cache: 'no-store' });
      if (gmailRes.ok) {
        const gmData = await gmailRes.json();
        if (gmData.gmail) {
          const isConnected = Boolean(gmData.gmail.is_connected);
          setGmailConnected(isConnected);
          setGmailEmail(gmData.gmail.google_email || '');
          setGmailName(gmData.gmail.google_name || '');
          if (isConnected && gmData.gmail.google_email) {
            setSupportEmail((prev) => {
              if (!prev || prev === 'notifications@demo-store.com' || prev === 'support@demo-store.com') {
                return gmData.gmail.google_email;
              }
              return prev;
            });
          }
        }
      }

      // Fetch Shopify connection status
      const shopifyRes = await fetch('/api/business/connections/shopify', { cache: 'no-store' });
      if (shopifyRes.ok) {
        const spData = await shopifyRes.json();
        if (spData.shopify) {
          setShopifyConnected(Boolean(spData.shopify.is_connected));
          setShopifyDomain(spData.shopify.shop_domain || '');
          setShopifyName(spData.shopify.shop_name || '');
          setShopifyCurrency(spData.shopify.currency || 'PKR');
          setShopifyPlan(spData.shopify.plan_name || 'Standard');
          setShopifySyncStatus(spData.shopify.sync_status || 'idle');
          setShopifyLastSyncedAt(spData.shopify.last_synced_at || null);
          setShopifyLastError(spData.shopify.last_error || null);
          setShopifyProductCount(Number(spData.shopify.product_count || 0));
          setShopifyOrderCount(Number(spData.shopify.order_count || 0));
          setShopifyConfiguredOnPlatform(Boolean(spData.shopify.is_configured_on_platform));
        }
      }

      // Fetch Custom Store connection status
      const customStoreRes = await fetch('/api/business/connections/custom-store', { cache: 'no-store' });
      if (customStoreRes.ok) {
        const csData = await customStoreRes.json();
        const connObj = csData.connection || csData.custom_store;
        if (connObj && connObj.is_connected) {
          setCustomStoreConnected(true);
          setCustomStoreName(connObj.store_name || '');
          setCustomStoreWebsite(connObj.website_url || '');
          setCustomStoreApiUrl(connObj.api_base_url || '');
          setCustomStoreMaskedKey(connObj.masked_api_key || '');
          setCustomStoreSyncStatus(connObj.sync_status || 'idle');
          setCustomStoreLastSyncedAt(connObj.last_synced_at || null);
          setCustomStoreLastError(connObj.last_error || null);
          setCustomStoreProductCount(Number(connObj.product_count || 0));
          setCustomStoreOrderCount(Number(connObj.order_count || 0));
        } else {
          setCustomStoreConnected(false);
        }
      }
    } catch (err) {
      console.error('Failed to load business settings:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchOrders = useCallback(async () => {
    setLoadingOrders(true);
    try {
      const res = await fetch('/api/orders', { cache: 'no-store' });
      if (res.ok) {
        const data = await res.json();
        setOrders(data.orders || []);
      }
    } catch (err) {
      console.error('Failed to load orders:', err);
    } finally {
      setLoadingOrders(false);
    }
  }, []);

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      const tabParam = params.get('tab');
      if (tabParam === 'integrations' || tabParam === 'connections' || tabParam === 'email') {
        setActiveTab('integrations');
      }
      const shopifyConn = params.get('shopify_connected');
      if (shopifyConn) {
        setMessage({
          type: 'success',
          text: `🎉 Successfully connected Shopify store (${shopifyConn})! Store catalog & orders are now synchronizing.`,
        });
      }
      const err = params.get('error');
      if (err) {
        setMessage({
          type: 'error',
          text: decodeURIComponent(err),
        });
      }
    }
  }, []);

  useEffect(() => {
    if (activeTab === 'demo_orders') {
      fetchOrders();
    }
  }, [activeTab, fetchOrders]);

  const handleConnectShopify = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!connectShopInput.trim()) {
      setMessage({ type: 'error', text: 'Please enter your Shopify store domain (e.g. my-store.myshopify.com).' });
      return;
    }

    setConnectingShopify(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/auth/shopify?shop=${encodeURIComponent(connectShopInput.trim())}`, {
        headers: { Accept: 'application/json' },
      });
      const data = await res.json();
      if (res.ok && data.url) {
        window.location.href = data.url;
      } else {
        setMessage({
          type: 'error',
          text: data.error || 'Failed to initiate Shopify connection.',
        });
      }
    } catch (err: unknown) {
      setMessage({
        type: 'error',
        text: err instanceof Error ? err.message : 'Network error connecting Shopify',
      });
    } finally {
      setConnectingShopify(false);
    }
  };

  const handleSyncShopify = async () => {
    setSyncingShopify(true);
    setMessage(null);
    try {
      const res = await fetch('/api/business/connections/shopify/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const data = await res.json();
      if (res.ok) {
        setMessage({
          type: 'success',
          text: 'Store sync initiated. Synchronizing products and checking order access...',
        });
        setTimeout(async () => {
          await fetchSettings();
          setSyncingShopify(false);
        }, 1200);
      } else {
        setMessage({
          type: 'error',
          text: data.error || 'Failed to trigger store sync',
        });
        setSyncingShopify(false);
      }
    } catch {
      setMessage({
        type: 'error',
        text: 'Failed to connect to sync endpoint',
      });
      setSyncingShopify(false);
    }
  };

  const handleDisconnectShopify = async () => {
    if (!confirm('Are you sure you want to disconnect your Shopify store? Automatic store sync will stop.')) {
      return;
    }
    setDisconnectingShopify(true);
    setMessage(null);
    try {
      const res = await fetch('/api/business/connections/shopify', {
        method: 'DELETE',
      });
      const data = await res.json();
      if (res.ok) {
        setMessage({
          type: 'success',
          text: 'Shopify store disconnected successfully.',
        });
        setShopifyConnected(false);
        setShopifyDomain('');
        setShopifyLastError(null);
        fetchSettings();
      } else {
        setMessage({
          type: 'error',
          text: data.error || 'Failed to disconnect store',
        });
      }
    } catch {
      setMessage({
        type: 'error',
        text: 'Failed to disconnect store',
      });
    } finally {
      setDisconnectingShopify(false);
    }
  };

  const handleTestCustomStore = async () => {
    if (!customStoreApiUrl.trim() || (!customStoreApiKey.trim() && !customStoreConnected)) {
      setMessage({ type: 'error', text: 'Please enter API Base URL and API Key to test connection.' });
      return;
    }
    setTestingCustomStore(true);
    setTestResult(null);
    try {
      const res = await fetch('/api/business/connections/custom-store/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          api_base_url: customStoreApiUrl.trim(),
          api_key: customStoreApiKey.trim() || undefined,
          website_url: customStoreWebsite.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setTestResult({
          success: true,
          message: `✓ Connected to "${data.store_profile?.store_name || customStoreName || 'Custom Store'}" successfully (${data.latency_ms}ms). Store identity verified.`,
          latency_ms: data.latency_ms,
        });
      } else {
        setTestResult({
          success: false,
          message: data.error || 'Connection test failed. Verify endpoint URL and credentials.',
        });
      }
    } catch (err: unknown) {
      setTestResult({
        success: false,
        message: err instanceof Error ? err.message : 'Network error testing custom store endpoint',
      });
    } finally {
      setTestingCustomStore(false);
    }
  };

  const handleSaveCustomStore = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!customStoreName.trim() || !customStoreWebsite.trim() || !customStoreApiUrl.trim()) {
      setMessage({ type: 'error', text: 'Store Name, Website URL, and API Base URL are required.' });
      return;
    }
    if (!customStoreConnected && !customStoreApiKey.trim()) {
      setMessage({ type: 'error', text: 'API Key is required to connect your custom store.' });
      return;
    }
    setSavingCustomStore(true);
    setMessage(null);
    try {
      const res = await fetch('/api/business/connections/custom-store', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          store_name: customStoreName.trim(),
          website_url: customStoreWebsite.trim(),
          api_base_url: customStoreApiUrl.trim(),
          api_key: customStoreApiKey.trim() || undefined,
          webhook_secret: customStoreWebhookSecret.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setMessage({
          type: 'success',
          text: `🎉 Custom Store "${data.connection?.store_name || customStoreName}" connected successfully. Credentials encrypted using AES-256-GCM.`,
        });
        setCustomStoreApiKey('');
        setCustomStoreWebhookSecret('');
        await fetchSettings();
      } else {
        setMessage({
          type: 'error',
          text: data.error || 'Failed to save Custom Store connection.',
        });
      }
    } catch (err: unknown) {
      setMessage({
        type: 'error',
        text: err instanceof Error ? err.message : 'Failed to save Custom Store connection.',
      });
    } finally {
      setSavingCustomStore(false);
    }
  };

  const handleSyncCustomStore = async () => {
    setSyncingCustomStore(true);
    setMessage(null);
    try {
      const res = await fetch('/api/business/connections/custom-store/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const data = await res.json();
      if (res.ok) {
        setMessage({
          type: 'success',
          text: `Custom store sync initiated (${data.job?.job_id || 'active'}). Synchronizing products & orders...`,
        });
        setTimeout(async () => {
          await fetchSettings();
          setSyncingCustomStore(false);
        }, 1200);
      } else {
        setMessage({
          type: 'error',
          text: data.error || 'Failed to start custom store sync',
        });
        setSyncingCustomStore(false);
      }
    } catch {
      setMessage({
        type: 'error',
        text: 'Failed to connect to custom store sync endpoint',
      });
      setSyncingCustomStore(false);
    }
  };

  const handleDisconnectCustomStore = async () => {
    if (!confirm('Are you sure you want to disconnect this custom store? Catalog sync will stop.')) {
      return;
    }
    setDisconnectingCustomStore(true);
    setMessage(null);
    try {
      const res = await fetch('/api/business/connections/custom-store', {
        method: 'DELETE',
      });
      const data = await res.json();
      if (res.ok) {
        setMessage({
          type: 'success',
          text: 'Custom store disconnected successfully.',
        });
        setCustomStoreConnected(false);
        setCustomStoreLastError(null);
        setTestResult(null);
        await fetchSettings();
      } else {
        setMessage({
          type: 'error',
          text: data.error || 'Failed to disconnect custom store',
        });
      }
    } catch {
      setMessage({
        type: 'error',
        text: 'Failed to disconnect custom store',
      });
    } finally {
      setDisconnectingCustomStore(false);
    }
  };

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setMessage(null);

    // Validate products
    for (const p of products) {
      if (!p.name || !p.name.trim()) {
        setMessage({ type: 'error', text: 'All products must have a valid name.' });
        setSaving(false);
        return;
      }
      if (typeof p.price !== 'number' || isNaN(p.price) || p.price < 0) {
        setMessage({ type: 'error', text: `Product "${p.name}" must have a valid price (>= 0).` });
        setSaving(false);
        return;
      }
    }

    try {
      const payload = {
        business_name: businessName,
        industry,
        country,
        timezone,
        currency,
        automation_mode: automationMode,
        working_hours: {
          start_time: startTime,
          end_time: endTime,
          days: activeDays,
          auto_reply_outside_hours: true,
        },
        connections: {
          website: {
            type: 'shopify',
            status: 'connected',
            hosted_inquiry_enabled: true,
          },
          email: {
            provider: gmailConnected ? 'gmail' : 'resend',
            sender_email: supportEmail,
            status: 'connected',
          },
        },
        order_issues_config: {
          followup_interval_hours: Math.max(1, Number(followupIntervalHours)),
          clarification_delay_minutes: Math.max(1, Number(clarificationHours)) * 60,
          carrier_check_interval_minutes: Math.max(1, Number(carrierCheckHours)) * 60,
          max_followup_attempts: Math.max(1, Math.min(10, Number(maxFollowupAttempts))),
          auto_escalate_to_owner: autoEscalateToOwner,
          owner_reminder_interval_minutes: Math.max(1, Number(ownerReminderHours)) * 60,
          auto_close_resolved_days: Math.max(1, Number(autoCloseResolvedDays)),
        },
        knowledge: {
          faqs,
          products_services: products,
          policies: {
            return_window_days: Number(returnWindowDays),
            shipping_timeframe: shippingTimeframe,
            general_rules: 'All returns must be unworn with tags attached.',
          },
        },
        return_window_days: Number(returnWindowDays),
      };

      const res = await fetch('/api/business', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to save settings.');
      }

      setMessage({
        type: 'success',
        text: 'Settings & Catalog saved successfully! AI assistant behavior and responses updated.',
      });
      fetchSettings();
    } catch (err: unknown) {
      setMessage({
        type: 'error',
        text: err instanceof Error ? err.message : 'Save failed',
      });
    } finally {
      setSaving(false);
    }
  };

  const handleSyncGmail = async () => {
    setSyncingGmail(true);
    setMessage(null);
    try {
      const res = await fetch('/api/business/connections/gmail/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const data = await res.json();
      if (res.ok) {
        setMessage({
          type: 'success',
          text: `Gmail sync completed. Ingested ${data.ingested_messages || 0} message(s).`,
        });
      } else {
        setMessage({
          type: 'error',
          text: data.error || 'Gmail sync failed',
        });
      }
    } catch (err) {
      setMessage({
        type: 'error',
        text: 'Failed to trigger Gmail sync',
      });
    } finally {
      setSyncingGmail(false);
    }
  };

  const openCreateOrderModal = () => {
    setEditingOrder(null);
    const randNum = Math.floor(1000 + Math.random() * 9000);
    setOrderForm({
      order_id: `ORD-${randNum}`,
      customer_name: 'Customer Demo',
      customer_email: 'customer@example.com',
      product_name: products[0]?.name || 'Embroidered Lawn Kurti',
      variant: 'Medium / Blue',
      quantity: 1,
      unit_price: products[0]?.price || 3500,
      total: products[0]?.price || 3500,
      currency: currency || 'PKR',
      status: 'shipped',
      tracking_number: `TRK-PK-${randNum}`,
    });
    setOrderMessage(null);
    setOrderModalOpen(true);
  };

  const openEditOrderModal = (ord: OrderRecord) => {
    setEditingOrder(ord);
    const rawItems = ord.items || ord.data?.items;
    const firstItem = Array.isArray(rawItems) && rawItems.length > 0 ? rawItems[0] : null;
    const data = ord.data || {};
    setOrderForm({
      order_id: ord.order_id,
      customer_name: ord.customer_name || String(data.customer_name || 'Demo Customer'),
      customer_email: ord.customer_email || String(data.customer_email || ''),
      product_name: firstItem?.name || firstItem?.title || 'Demo Item',
      variant: firstItem?.variant || firstItem?.size || '',
      quantity: firstItem?.qty || firstItem?.quantity || 1,
      unit_price: Number(firstItem?.price || ord.total || 0),
      total: Number(ord.total || 0),
      currency: ord.currency || String(data.currency || currency || 'PKR'),
      status: ord.status || String(data.status || 'shipped'),
      tracking_number: String(data.tracking_number || data.tracking || ''),
    });
    setOrderMessage(null);
    setOrderModalOpen(true);
  };

  const handleSaveOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    setOrderSaving(true);
    setOrderMessage(null);

    if (!orderForm.order_id.trim()) {
      setOrderMessage({ type: 'error', text: 'Order ID is required.' });
      setOrderSaving(false);
      return;
    }
    if (!orderForm.customer_email.trim()) {
      setOrderMessage({ type: 'error', text: 'Customer Email is required for privacy matching.' });
      setOrderSaving(false);
      return;
    }

    try {
      const orderPayload = {
        order_id: orderForm.order_id.trim().toUpperCase(),
        customer_name: orderForm.customer_name.trim(),
        customer_email: orderForm.customer_email.trim().toLowerCase(),
        items: [
          {
            name: orderForm.product_name.trim(),
            variant: orderForm.variant.trim(),
            qty: Number(orderForm.quantity),
            price: Number(orderForm.unit_price),
          },
        ],
        total: Number(orderForm.total),
        currency: orderForm.currency,
        status: orderForm.status,
        data: {
          tracking_number: orderForm.tracking_number.trim(),
          is_demo: true,
          demo_badge: 'Demo Order',
        },
      };

      const res = await fetch('/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(orderPayload),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to save order.');
      }

      setOrderMessage({ type: 'success', text: `Demo Order ${orderForm.order_id} saved successfully.` });
      fetchOrders();
      setTimeout(() => {
        setOrderModalOpen(false);
      }, 700);
    } catch (err: unknown) {
      setOrderMessage({
        type: 'error',
        text: err instanceof Error ? err.message : 'Failed to save demo order.',
      });
    } finally {
      setOrderSaving(false);
    }
  };

  const handleDeleteOrder = async (orderId: string) => {
    if (!confirm(`Are you sure you want to delete demo order ${orderId}?`)) return;
    try {
      const res = await fetch(`/api/orders?order_id=${encodeURIComponent(orderId)}`, {
        method: 'DELETE',
      });
      if (res.ok) {
        fetchOrders();
      } else {
        const d = await res.json();
        alert(d.error || 'Failed to delete demo order');
      }
    } catch (err) {
      console.error('Delete order error:', err);
    }
  };

  if (loading) {
    return (
      <AppLayout>
        <div className="flex items-center justify-center min-h-[400px]">
          <Loader2 className="w-8 h-8 animate-spin text-indigo-600" />
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <form onSubmit={handleSaveSettings} className="space-y-6 pb-12 max-w-5xl">
        {/* Header with Title and Global Save Button */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-6 rounded-2xl border border-slate-200 shadow-xs">
          <div>
            <h1 className="text-xl font-bold text-slate-900 flex items-center gap-2.5">
              <Store className="w-6 h-6 text-indigo-600" />
              <span>{businessName} Settings</span>
            </h1>
            <p className="text-xs text-slate-500 mt-1">
              Configure AI response automation, store catalog, business profile, and demo orders.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <button
              type="submit"
              disabled={saving}
              className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-xs font-bold rounded-xl shadow-xs transition-all flex items-center gap-2 cursor-pointer"
            >
              {saving ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Save className="w-4 h-4" />
              )}
              <span>{saving ? 'Saving...' : 'Save All Settings'}</span>
            </button>
          </div>
        </div>

        {/* Global Feedback Banner */}
        {message && (
          <div
            className={`p-4 rounded-xl text-xs font-semibold flex items-center gap-2.5 ${
              message.type === 'success'
                ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                : 'bg-rose-50 text-rose-800 border border-rose-200'
            }`}
          >
            {message.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600" />
            ) : (
              <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" />
            )}
            <span>{message.text}</span>
          </div>
        )}

        {/* Settings Tab Bar */}
        <div className="flex items-center gap-2 border-b border-slate-200 pb-2 text-xs font-semibold overflow-x-auto">
          <button
            type="button"
            onClick={() => setActiveTab('behavior')}
            className={`px-4 py-2 rounded-xl transition-colors cursor-pointer shrink-0 ${
              activeTab === 'behavior'
                ? 'bg-indigo-50 text-indigo-700 font-bold'
                : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            ⚡ Assistant Behavior
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('order_issues')}
            className={`px-4 py-2 rounded-xl transition-colors cursor-pointer shrink-0 flex items-center gap-1.5 ${
              activeTab === 'order_issues'
                ? 'bg-indigo-50 text-indigo-700 font-bold'
                : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            <Clock className="w-3.5 h-3.5" />
            <span>Order Issues & Follow-ups</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('profile')}
            className={`px-4 py-2 rounded-xl transition-colors cursor-pointer shrink-0 ${
              activeTab === 'profile'
                ? 'bg-indigo-50 text-indigo-700 font-bold'
                : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            🏢 Business Profile & Hours
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('integrations')}
            className={`px-4 py-2 rounded-xl transition-colors cursor-pointer shrink-0 flex items-center gap-1.5 ${
              activeTab === 'integrations' || activeTab === 'email'
                ? 'bg-indigo-50 text-indigo-700 font-bold'
                : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            <ShoppingBag className="w-3.5 h-3.5" />
            <span>Store Connections & Integrations</span>
            {(shopifyConnected || customStoreConnected) && (
              <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
            )}
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('knowledge')}
            className={`px-4 py-2 rounded-xl transition-colors cursor-pointer shrink-0 ${
              activeTab === 'knowledge'
                ? 'bg-indigo-50 text-indigo-700 font-bold'
                : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            📚 Store FAQs & Catalog
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('demo_orders')}
            className={`px-4 py-2 rounded-xl transition-colors cursor-pointer shrink-0 flex items-center gap-1.5 ${
              activeTab === 'demo_orders'
                ? 'bg-indigo-50 text-indigo-700 font-bold'
                : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            <Package className="w-3.5 h-3.5" />
            <span>Orders & Sync</span>
            {shopifyConnected && shopifyOrderCount > 0 && (
              <span className="px-1.5 py-0.5 rounded-full text-[10px] bg-emerald-100 text-emerald-700 font-bold">
                {shopifyOrderCount} Synced
              </span>
            )}
          </button>
        </div>

        {/* TAB 1: Assistant Behavior */}
        {activeTab === 'behavior' && (
          <div className="space-y-6">
            <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-xs space-y-5">
              <div>
                <h2 className="text-sm font-bold text-slate-900">
                  Assistant Automation Mode
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Choose how the assistant handles incoming customer emails.
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {/* 1. auto_routine */}
                <div
                  onClick={() => setAutomationMode('auto_routine')}
                  className={`p-5 rounded-2xl border-2 cursor-pointer transition-all ${
                    automationMode === 'auto_routine'
                      ? 'border-indigo-600 bg-indigo-50/40 shadow-xs'
                      : 'border-slate-200 bg-white hover:border-slate-300'
                  }`}
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-2xl">⚡</span>
                    <input
                      type="radio"
                      name="automation_mode"
                      checked={automationMode === 'auto_routine'}
                      onChange={() => setAutomationMode('auto_routine')}
                      className="accent-indigo-600 w-4 h-4"
                    />
                  </div>
                  <div className="font-bold text-sm text-slate-900">
                    Automatic routine replies
                  </div>
                  <p className="text-xs text-slate-500 mt-1.5 leading-relaxed">
                    AI instantly replies to greetings, store hours, order delivery status, product prices, and published policies without waiting for your approval.
                  </p>
                  <div className="mt-3 text-[11px] font-semibold text-emerald-700 bg-emerald-50 px-2 py-1 rounded-lg inline-block">
                    Recommended for fast response
                  </div>
                </div>

                {/* 2. draft_only */}
                <div
                  onClick={() => setAutomationMode('draft_only')}
                  className={`p-5 rounded-2xl border-2 cursor-pointer transition-all ${
                    automationMode === 'draft_only'
                      ? 'border-indigo-600 bg-indigo-50/40 shadow-xs'
                      : 'border-slate-200 bg-white hover:border-slate-300'
                  }`}
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-2xl">✍️</span>
                    <input
                      type="radio"
                      name="automation_mode"
                      checked={automationMode === 'draft_only'}
                      onChange={() => setAutomationMode('draft_only')}
                      className="accent-indigo-600 w-4 h-4"
                    />
                  </div>
                  <div className="font-bold text-sm text-slate-900">
                    Review every reply
                  </div>
                  <p className="text-xs text-slate-500 mt-1.5 leading-relaxed">
                    AI writes recommended draft replies for every email, but holds all of them in the approvals queue for your manual confirmation before sending.
                  </p>
                </div>

                {/* 3. paused */}
                <div
                  onClick={() => setAutomationMode('paused')}
                  className={`p-5 rounded-2xl border-2 cursor-pointer transition-all ${
                    automationMode === 'paused'
                      ? 'border-indigo-600 bg-indigo-50/40 shadow-xs'
                      : 'border-slate-200 bg-white hover:border-slate-300'
                  }`}
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-2xl">⏸️</span>
                    <input
                      type="radio"
                      name="automation_mode"
                      checked={automationMode === 'paused'}
                      onChange={() => setAutomationMode('paused')}
                      className="accent-indigo-600 w-4 h-4"
                    />
                  </div>
                  <div className="font-bold text-sm text-slate-900">
                    Pause assistant
                  </div>
                  <p className="text-xs text-slate-500 mt-1.5 leading-relaxed">
                    Turns off all automatic responses and draft generation. You can still read emails and reply manually from the inbox.
                  </p>
                </div>
              </div>
            </div>

            {/* Permanent Safety Rules */}
            <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-xs space-y-4">
              <div className="flex items-center gap-2 text-indigo-700">
                <ShieldCheck className="w-5 h-5" />
                <h2 className="text-sm font-bold text-slate-900">
                  Always-Active Merchant Protection Rules
                </h2>
              </div>
              <p className="text-xs text-slate-500">
                These rules are permanently enforced to protect your business. They cannot be turned off.
              </p>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                <div className="p-3.5 rounded-xl border border-slate-200 bg-slate-50/70 space-y-1">
                  <div className="font-bold text-slate-900 flex items-center gap-1.5">
                    <span className="text-emerald-600">✓</span>
                    <span>Refund & Exchange Approval Gate</span>
                  </div>
                  <p className="text-slate-600">
                    Any request that involves sending money back, issuing replacements, or cancelling orders is always held for your approval.
                  </p>
                </div>

                <div className="p-3.5 rounded-xl border border-slate-200 bg-slate-50/70 space-y-1">
                  <div className="font-bold text-slate-900 flex items-center gap-1.5">
                    <span className="text-emerald-600">✓</span>
                    <span>Customer Privacy & Order Verification</span>
                  </div>
                  <p className="text-slate-600">
                    Order details are only disclosed to senders matching the customer email on file. Unverified senders cannot access private order records.
                  </p>
                </div>

                <div className="p-3.5 rounded-xl border border-slate-200 bg-slate-50/70 space-y-1">
                  <div className="font-bold text-slate-900 flex items-center gap-1.5">
                    <span className="text-emerald-600">✓</span>
                    <span>No Made-Up Information</span>
                  </div>
                  <p className="text-slate-600">
                    The AI only uses verified prices, stock counts, and policies you have entered. It will ask clarification rather than guessing.
                  </p>
                </div>

                <div className="p-3.5 rounded-xl border border-slate-200 bg-slate-50/70 space-y-1">
                  <div className="font-bold text-slate-900 flex items-center gap-1.5">
                    <span className="text-emerald-600">✓</span>
                    <span>Automated Loop Prevention</span>
                  </div>
                  <p className="text-slate-600">
                    The assistant never auto-replies to out-of-office notices, mailing lists, or automated notification bots.
                  </p>
                </div>
              </div>
            </div>

            {/* Order Issue Resolution & Follow-Up Automation Settings */}
            <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-xs space-y-5">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <h2 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                    <Package className="w-4 h-4 text-indigo-600" />
                    <span>Order Issue Follow-Up & Escalation Timers</span>
                  </h2>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Configure timing intervals and escalation rules for unresolved customer order issues.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setActiveTab('order_issues')}
                  className="text-xs font-semibold text-indigo-600 hover:text-indigo-800 transition-colors flex items-center gap-1 cursor-pointer"
                >
                  <span>View Full Order Issues Guide</span>
                  <ExternalLink className="w-3.5 h-3.5" />
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5 pt-2">
                {/* Clarification follow-up interval */}
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-700 block">
                    Customer Clarification Wait Time (Hours)
                  </label>
                  <p className="text-[11px] text-slate-500">
                    Wait time before sending a clarification reminder when an order number is missing.
                  </p>
                  <input
                    type="number"
                    min={1}
                    max={168}
                    value={clarificationHours}
                    onChange={(e) => setClarificationHours(Math.max(1, parseInt(e.target.value || '1', 10)))}
                    className="w-full px-3.5 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:ring-2 focus:ring-indigo-500 focus:outline-hidden text-slate-900 font-semibold"
                  />
                </div>

                {/* General customer follow-up retry interval */}
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-700 block">
                    Customer Follow-Up Retry Interval (Hours)
                  </label>
                  <p className="text-[11px] text-slate-500">
                    How frequently to re-dispatch pending follow-up inquiries to customers.
                  </p>
                  <input
                    type="number"
                    min={1}
                    max={168}
                    value={followupIntervalHours}
                    onChange={(e) => setFollowupIntervalHours(Math.max(1, parseInt(e.target.value || '1', 10)))}
                    className="w-full px-3.5 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:ring-2 focus:ring-indigo-500 focus:outline-hidden text-slate-900 font-semibold"
                  />
                </div>

                {/* Carrier check interval */}
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-700 block">
                    Carrier Status Check Interval (Hours)
                  </label>
                  <p className="text-[11px] text-slate-500">
                    Frequency to poll and verify updated carrier tracking data for unfulfilled or delayed parcels.
                  </p>
                  <input
                    type="number"
                    min={1}
                    max={72}
                    value={carrierCheckHours}
                    onChange={(e) => setCarrierCheckHours(Math.max(1, parseInt(e.target.value || '1', 10)))}
                    className="w-full px-3.5 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:ring-2 focus:ring-indigo-500 focus:outline-hidden text-slate-900 font-semibold"
                  />
                </div>

                {/* Max follow-up attempts */}
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-700 block">
                    Max Automated Follow-Up Attempts
                  </label>
                  <p className="text-[11px] text-slate-500">
                    Maximum reminders sent before automated follow-ups stop to prevent spam loops (1 - 5).
                  </p>
                  <input
                    type="number"
                    min={1}
                    max={5}
                    value={maxFollowupAttempts}
                    onChange={(e) => setMaxFollowupAttempts(Math.max(1, Math.min(5, parseInt(e.target.value || '1', 10))))}
                    className="w-full px-3.5 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:ring-2 focus:ring-indigo-500 focus:outline-hidden text-slate-900 font-semibold"
                  />
                </div>

                {/* Owner reminder interval */}
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-700 block">
                    Owner Task Reminder Interval (Hours)
                  </label>
                  <p className="text-[11px] text-slate-500">
                    How frequently to re-notify store owners on the Home dashboard when tasks remain pending.
                  </p>
                  <input
                    type="number"
                    min={1}
                    max={168}
                    value={ownerReminderHours}
                    onChange={(e) => setOwnerReminderHours(Math.max(1, parseInt(e.target.value || '1', 10)))}
                    className="w-full px-3.5 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:ring-2 focus:ring-indigo-500 focus:outline-hidden text-slate-900 font-semibold"
                  />
                </div>

                {/* Auto-close resolved days */}
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-700 block">
                    Auto-Close Resolved Issues (Days)
                  </label>
                  <p className="text-[11px] text-slate-500">
                    Days after which resolved cases are permanently archived from active queues.
                  </p>
                  <input
                    type="number"
                    min={1}
                    max={90}
                    value={autoCloseResolvedDays}
                    onChange={(e) => setAutoCloseResolvedDays(Math.max(1, parseInt(e.target.value || '1', 10)))}
                    className="w-full px-3.5 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:ring-2 focus:ring-indigo-500 focus:outline-hidden text-slate-900 font-semibold"
                  />
                </div>
              </div>

              {/* Auto escalate toggle */}
              <div className="pt-3 border-t border-slate-200 flex items-center justify-between gap-4">
                <div>
                  <div className="text-xs font-bold text-slate-900">
                    Auto-Escalate Unresolved Cases to Store Owner
                  </div>
                  <p className="text-[11px] text-slate-500">
                    When maximum follow-up attempts are reached without customer reply, automatically create an owner investigation task and change status to awaiting owner.
                  </p>
                </div>
                <input
                  type="checkbox"
                  checked={autoEscalateToOwner}
                  onChange={(e) => setAutoEscalateToOwner(e.target.checked)}
                  className="w-4 h-4 accent-indigo-600 rounded cursor-pointer shrink-0"
                />
              </div>
            </div>
          </div>
        )}

        {/* TAB 1.5: Dedicated Order Issues & Follow-ups Tab */}
        {activeTab === 'order_issues' && (
          <div className="space-y-6">
            {/* Header Card */}
            <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-xs space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                  <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
                    <Clock className="w-5 h-5 text-indigo-600" />
                    <span>Order Issue Follow-Up, Timers & Escalation Settings</span>
                  </h2>
                  <p className="text-xs text-slate-500 mt-1 max-w-2xl">
                    Configure how the AI operator schedules customer follow-ups, checks fulfillment progress, and escalates stalled customer inquiries to the store owner.
                  </p>
                </div>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-xs font-bold rounded-xl shadow-xs transition-all flex items-center gap-2 cursor-pointer shrink-0 self-start sm:self-auto"
                >
                  {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                  <span>{saving ? 'Saving...' : 'Save Timing Settings'}</span>
                </button>
              </div>

              {/* Status Alert Banner */}
              <div className="p-4 bg-indigo-50/70 rounded-xl border border-indigo-100 flex items-start gap-3 text-xs">
                <ShieldCheck className="w-4 h-4 text-indigo-600 shrink-0 mt-0.5" />
                <div className="space-y-1 text-slate-700">
                  <div className="font-bold text-indigo-950">
                    Strict Multi-Tenant Isolation & Idempotent Processing
                  </div>
                  <p className="text-slate-600 leading-relaxed">
                    All follow-up jobs are scheduled in PostgreSQL with row-level tenant keys. Background cron processors (or n8n schedules) claim jobs atomically using <code className="font-mono bg-white px-1.5 py-0.5 rounded border border-indigo-200 text-indigo-800">SELECT ... FOR UPDATE SKIP LOCKED</code>, guaranteeing that no customer receives duplicate follow-up emails even if cron runs concurrently.
                  </p>
                </div>
              </div>
            </div>

            {/* Timing Inputs Card */}
            <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-xs space-y-6">
              <div className="border-b border-slate-100 pb-3">
                <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider">
                  Automated Queue Intervals
                </h3>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  Set hourly timing intervals for AI follow-up scheduling.
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {/* 1. Customer Clarification */}
                <div className="space-y-2 bg-slate-50/60 p-4 rounded-xl border border-slate-200/80">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-bold text-slate-800 block">
                      Customer Clarification
                    </label>
                    <span className="text-[11px] font-mono text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded font-bold">
                      {clarificationHours}h ({clarificationHours >= 24 ? `${(clarificationHours / 24).toFixed(1)} days` : `${clarificationHours} hours`})
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-500 leading-relaxed">
                    How long to wait before sending a gentle reminder if a customer reported an issue but hasn't provided their order reference.
                  </p>
                  <div className="pt-1">
                    <input
                      type="number"
                      min={1}
                      max={168}
                      value={clarificationHours}
                      onChange={(e) => setClarificationHours(Math.max(1, parseInt(e.target.value || '1', 10)))}
                      className="w-full px-3.5 py-2 text-xs bg-white border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:outline-hidden font-semibold text-slate-900"
                    />
                  </div>
                </div>

                {/* 2. Customer Follow-up Retry Interval */}
                <div className="space-y-2 bg-slate-50/60 p-4 rounded-xl border border-slate-200/80">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-bold text-slate-800 block">
                      Customer Retry Interval
                    </label>
                    <span className="text-[11px] font-mono text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded font-bold">
                      {followupIntervalHours}h ({followupIntervalHours >= 24 ? `${(followupIntervalHours / 24).toFixed(1)} days` : `${followupIntervalHours} hours`})
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-500 leading-relaxed">
                    Time between subsequent follow-up reminder emails sent to customers who have not replied.
                  </p>
                  <div className="pt-1">
                    <input
                      type="number"
                      min={1}
                      max={168}
                      value={followupIntervalHours}
                      onChange={(e) => setFollowupIntervalHours(Math.max(1, parseInt(e.target.value || '1', 10)))}
                      className="w-full px-3.5 py-2 text-xs bg-white border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:outline-hidden font-semibold text-slate-900"
                    />
                  </div>
                </div>

                {/* 3. Carrier Check Interval */}
                <div className="space-y-2 bg-slate-50/60 p-4 rounded-xl border border-slate-200/80">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-bold text-slate-800 block">
                      Carrier Status Polling
                    </label>
                    <span className="text-[11px] font-mono text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded font-bold">
                      {carrierCheckHours}h
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-500 leading-relaxed">
                    Frequency to poll and verify updated carrier tracking data for unfulfilled or delayed parcels from Shopify.
                  </p>
                  <div className="pt-1">
                    <input
                      type="number"
                      min={1}
                      max={72}
                      value={carrierCheckHours}
                      onChange={(e) => setCarrierCheckHours(Math.max(1, parseInt(e.target.value || '1', 10)))}
                      className="w-full px-3.5 py-2 text-xs bg-white border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:outline-hidden font-semibold text-slate-900"
                    />
                  </div>
                </div>

                {/* 4. Owner Task Reminder Interval */}
                <div className="space-y-2 bg-slate-50/60 p-4 rounded-xl border border-slate-200/80">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-bold text-slate-800 block">
                      Owner Task Reminder
                    </label>
                    <span className="text-[11px] font-mono text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded font-bold">
                      {ownerReminderHours}h ({ownerReminderHours >= 24 ? `${(ownerReminderHours / 24).toFixed(1)} days` : `${ownerReminderHours} hours`})
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-500 leading-relaxed">
                    How frequently to re-notify store owners when investigation tasks (e.g. warehouse fulfillment) remain pending.
                  </p>
                  <div className="pt-1">
                    <input
                      type="number"
                      min={1}
                      max={168}
                      value={ownerReminderHours}
                      onChange={(e) => setOwnerReminderHours(Math.max(1, parseInt(e.target.value || '1', 10)))}
                      className="w-full px-3.5 py-2 text-xs bg-white border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:outline-hidden font-semibold text-slate-900"
                    />
                  </div>
                </div>

                {/* 5. Max Follow-up Attempts */}
                <div className="space-y-2 bg-slate-50/60 p-4 rounded-xl border border-slate-200/80">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-bold text-slate-800 block">
                      Max Reminder Attempts
                    </label>
                    <span className="text-[11px] font-mono text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded font-bold">
                      {maxFollowupAttempts} attempts
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-500 leading-relaxed">
                    Maximum automated reminders sent before the operator halts automated emails to prevent customer spam loops.
                  </p>
                  <div className="pt-1">
                    <input
                      type="number"
                      min={1}
                      max={5}
                      value={maxFollowupAttempts}
                      onChange={(e) => setMaxFollowupAttempts(Math.max(1, Math.min(5, parseInt(e.target.value || '1', 10))))}
                      className="w-full px-3.5 py-2 text-xs bg-white border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:outline-hidden font-semibold text-slate-900"
                    />
                  </div>
                </div>

                {/* 6. Auto-Close Resolved Days */}
                <div className="space-y-2 bg-slate-50/60 p-4 rounded-xl border border-slate-200/80">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-bold text-slate-800 block">
                      Auto-Archive Resolved
                    </label>
                    <span className="text-[11px] font-mono text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded font-bold">
                      {autoCloseResolvedDays} days
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-500 leading-relaxed">
                    Days after which resolved or closed cases are automatically archived from the active dashboard views.
                  </p>
                  <div className="pt-1">
                    <input
                      type="number"
                      min={1}
                      max={90}
                      value={autoCloseResolvedDays}
                      onChange={(e) => setAutoCloseResolvedDays(Math.max(1, parseInt(e.target.value || '1', 10)))}
                      className="w-full px-3.5 py-2 text-xs bg-white border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:outline-hidden font-semibold text-slate-900"
                    />
                  </div>
                </div>
              </div>

              {/* Auto Escalate Toggle Card */}
              <div className="p-4 rounded-xl border border-slate-200 bg-slate-50/50 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="space-y-1">
                  <div className="text-xs font-bold text-slate-900 flex items-center gap-2">
                    <span>Auto-Escalate Exhausted Reminders to Owner</span>
                    <span className="px-2 py-0.5 rounded text-[10px] bg-amber-100 text-amber-800 font-bold border border-amber-200">
                      Recommended
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-500 max-w-2xl leading-relaxed">
                    When maximum customer reminders ({maxFollowupAttempts}) are reached without reply, the AI changes status from <code className="font-mono text-indigo-700 bg-indigo-50 px-1 py-0.5 rounded">awaiting_customer</code> to <code className="font-mono text-amber-800 bg-amber-50 px-1 py-0.5 rounded">awaiting_owner</code> and assigns a task to the store owner's dashboard.
                  </p>
                </div>
                <label className="relative inline-flex items-center cursor-pointer shrink-0">
                  <input
                    type="checkbox"
                    checked={autoEscalateToOwner}
                    onChange={(e) => setAutoEscalateToOwner(e.target.checked)}
                    className="sr-only peer"
                  />
                  <div className="w-11 h-6 bg-slate-200 peer-focus:outline-hidden rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-indigo-600"></div>
                </label>
              </div>
            </div>

            {/* Lifecycle Safety Card */}
            <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-xs space-y-4">
              <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-emerald-600" />
                <span>Order Issue Lifecycle & Human Governance Rules</span>
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs text-slate-600">
                <div className="p-3 bg-slate-50 rounded-xl border border-slate-200/80 space-y-1.5">
                  <div className="font-bold text-slate-900">1. Grounded Findings</div>
                  <p className="text-[11px] text-slate-500 leading-relaxed">
                    The AI checks actual Shopify fulfillment status. If an order is unfulfilled, it never claims the parcel was shipped or invents tracking numbers.
                  </p>
                </div>
                <div className="p-3 bg-slate-50 rounded-xl border border-slate-200/80 space-y-1.5">
                  <div className="font-bold text-slate-900">2. Customer Privacy Verification</div>
                  <p className="text-[11px] text-slate-500 leading-relaxed">
                    Order information is disclosed only when the customer's email matches the verified order record, protecting customer privacy.
                  </p>
                </div>
                <div className="p-3 bg-slate-50 rounded-xl border border-slate-200/80 space-y-1.5">
                  <div className="font-bold text-slate-900">3. Physical Task Separation</div>
                  <p className="text-[11px] text-slate-500 leading-relaxed">
                    Sending an acknowledgment or approving an email draft never closes the physical fulfillment task. Financial actions remain gated behind owner authorization.
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* TAB 2: Business Profile & Hours */}
        {activeTab === 'profile' && (
          <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-xs space-y-6">
            <div>
              <h2 className="text-sm font-bold text-slate-900">
                Business Profile & Operating Hours
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                General details used by the AI to represent your brand in customer communications.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Store / Brand Name
                </label>
                <input
                  type="text"
                  value={businessName}
                  onChange={(e) => setBusinessName(e.target.value)}
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 focus:bg-white focus:ring-2 focus:ring-indigo-500 focus:outline-hidden"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Industry / Category
                </label>
                <select
                  value={industry}
                  onChange={(e) => setIndustry(e.target.value as IndustryType)}
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 focus:bg-white focus:ring-2 focus:ring-indigo-500 focus:outline-hidden"
                >
                  <option value="ecommerce">E-Commerce & Online Retail</option>
                  <option value="clothing">Apparel & Fashion</option>
                  <option value="jewelry">Jewelry & Accessories</option>
                  <option value="electronics">Electronics & Gadgets</option>
                  <option value="services">Professional Services</option>
                  <option value="real_estate">Real Estate & Property</option>
                </select>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Operating Country
                </label>
                <input
                  type="text"
                  value={country}
                  onChange={(e) => setCountry(e.target.value)}
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 focus:bg-white focus:ring-2 focus:ring-indigo-500 focus:outline-hidden"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Timezone
                </label>
                <select
                  value={timezone}
                  onChange={(e) => setTimezone(e.target.value)}
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 focus:bg-white focus:ring-2 focus:ring-indigo-500 focus:outline-hidden"
                >
                  {TIMEZONE_OPTIONS.map((tz) => (
                    <option key={tz.value} value={tz.value}>
                      {tz.label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Store Currency
                </label>
                <select
                  value={currency}
                  onChange={(e) => setCurrency(e.target.value)}
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 focus:bg-white focus:ring-2 focus:ring-indigo-500 focus:outline-hidden"
                >
                  {CURRENCY_OPTIONS.map((c) => (
                    <option key={c.value} value={c.value}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="pt-4 border-t border-slate-100">
              <h3 className="text-xs font-bold text-slate-900 mb-2">
                Operating Business Hours
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    Opening Time
                  </label>
                  <input
                    type="time"
                    value={startTime}
                    onChange={(e) => setStartTime(e.target.value)}
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-900"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    Closing Time
                  </label>
                  <input
                    type="time"
                    value={endTime}
                    onChange={(e) => setEndTime(e.target.value)}
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-900"
                  />
                </div>
              </div>
            </div>
          </div>
        )}

        {/* TAB 3: Integrations & Store (Custom Store + Shopify + Gmail) */}
        {(activeTab === 'integrations' || activeTab === 'email') && (
          <div className="space-y-6">
            {/* 0. Custom Store Connector Card */}
            <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-xs space-y-6">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="flex items-start sm:items-center gap-3.5 flex-1 min-w-0">
                  <div className="w-12 h-12 rounded-2xl bg-indigo-50 border border-indigo-200 flex items-center justify-center text-indigo-600 shadow-xs shrink-0">
                    <Database className="w-6 h-6" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-bold text-slate-900 flex flex-wrap items-center gap-2">
                      <span>Custom Store API Integration</span>
                      <span className="px-2 py-0.5 rounded text-[10px] bg-indigo-100 text-indigo-800 font-bold">
                        v1 REST API
                      </span>
                      {customStoreConnected ? (
                        customStoreSyncStatus === 'syncing' ? (
                          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-blue-100 text-blue-800 border border-blue-200">
                            <Loader2 className="w-3 h-3 animate-spin text-blue-600 shrink-0" />
                            Syncing...
                          </span>
                        ) : customStoreSyncStatus === 'failed' ? (
                          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-rose-100 text-rose-800 border border-rose-200">
                            <AlertCircle className="w-3 h-3 text-rose-600 shrink-0" />
                            Sync Failed
                          </span>
                        ) : customStoreSyncStatus === 'partial_failed' ? (
                          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-amber-100 text-amber-800 border border-amber-200">
                            <AlertCircle className="w-3 h-3 text-amber-600 shrink-0" />
                            Partial Sync
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-200">
                            <CheckCircle2 className="w-3 h-3 text-emerald-600 shrink-0" />
                            Connected & Synced
                          </span>
                        )
                      ) : (
                        <span className="px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-slate-100 text-slate-600 border border-slate-200">
                          Not Connected
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">
                      Connect your custom website’s authenticated API to sync catalog products, inventory, orders, and fulfillment updates. Fully protected with AES-256-GCM encryption, SSRF outbound guardrails, and tenant-scoped identity.
                    </p>
                  </div>
                </div>

                {customStoreConnected && (
                  <div className="flex flex-wrap items-center gap-2 self-start sm:self-auto shrink-0">
                    <button
                      type="button"
                      onClick={handleSyncCustomStore}
                      disabled={syncingCustomStore}
                      className="px-3.5 py-2 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 text-indigo-800 text-xs font-semibold rounded-xl transition-colors cursor-pointer flex items-center gap-1.5"
                    >
                      <RefreshCw
                        className={`w-3.5 h-3.5 ${syncingCustomStore ? 'animate-spin text-indigo-600' : 'text-indigo-700'}`}
                      />
                      <span>{syncingCustomStore ? 'Syncing Custom Store...' : 'Sync Now'}</span>
                    </button>
                    <button
                      type="button"
                      onClick={handleTestCustomStore}
                      disabled={testingCustomStore}
                      className="px-3.5 py-2 bg-white hover:bg-slate-50 border border-slate-200 text-slate-700 text-xs font-semibold rounded-xl transition-colors cursor-pointer flex items-center gap-1.5"
                    >
                      {testingCustomStore ? <Loader2 className="w-3.5 h-3.5 animate-spin text-indigo-600" /> : <Link2 className="w-3.5 h-3.5" />}
                      <span>Test Connection</span>
                    </button>
                    <button
                      type="button"
                      onClick={handleDisconnectCustomStore}
                      disabled={disconnectingCustomStore}
                      className="px-3.5 py-2 bg-white hover:bg-rose-50 border border-slate-200 hover:border-rose-200 text-rose-600 text-xs font-semibold rounded-xl transition-colors cursor-pointer flex items-center gap-1.5"
                    >
                      {disconnectingCustomStore ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <X className="w-3.5 h-3.5" />}
                      <span>Disconnect</span>
                    </button>
                  </div>
                )}
              </div>

              {/* Status Banner or Test Result */}
              {testResult && (
                <div
                  className={`p-3.5 rounded-xl border text-xs flex items-center gap-2.5 ${
                    testResult.success
                      ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                      : 'bg-rose-50 border-rose-200 text-rose-900'
                  }`}
                >
                  {testResult.success ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                  ) : (
                    <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
                  )}
                  <span className="flex-1">{testResult.message}</span>
                </div>
              )}

              {customStoreLastError && (
                <div className="p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-900 text-xs flex items-start gap-2.5">
                  <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                  <div>
                    <span className="font-bold block">Sync Error:</span>
                    <span>{customStoreLastError}</span>
                  </div>
                </div>
              )}

              {/* Connected Details Grid */}
              {customStoreConnected ? (
                <div className="space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
                    <div className="p-4 rounded-xl bg-slate-50 border border-slate-200">
                      <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider block">
                        Connected Custom Store
                      </span>
                      <div className="font-bold text-slate-900 text-sm mt-1 truncate">
                        {customStoreName || 'Custom Store'}
                      </div>
                      <a
                        href={customStoreWebsite}
                        target="_blank"
                        rel="noreferrer"
                        className="text-[11px] text-indigo-600 hover:underline flex items-center gap-1 mt-0.5 truncate"
                      >
                        <span>{customStoreWebsite}</span>
                        <ExternalLink className="w-3 h-3 inline shrink-0" />
                      </a>
                    </div>

                    <div className="p-4 rounded-xl bg-slate-50 border border-slate-200">
                      <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider block">
                        Synced Products
                      </span>
                      <div className="font-bold text-slate-900 text-sm mt-1">
                        {customStoreProductCount} Products
                      </div>
                      <span className="text-[11px] text-emerald-600 font-semibold block mt-0.5">
                        ✓ In Stock & Grounded
                      </span>
                    </div>

                    <div className="p-4 rounded-xl bg-slate-50 border border-slate-200">
                      <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider block">
                        Synced Orders
                      </span>
                      <div className="font-bold text-slate-900 text-sm mt-1">
                        {customStoreOrderCount} Orders
                      </div>
                      <span className="text-[11px] text-slate-500 font-medium block mt-0.5">
                        Multi-Store Isolation Active
                      </span>
                    </div>

                    <div className="p-4 rounded-xl bg-slate-50 border border-slate-200">
                      <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider block">
                        Last Custom Sync
                      </span>
                      <div className="font-bold text-slate-900 text-sm mt-1">
                        {syncingCustomStore || customStoreSyncStatus === 'syncing' ? (
                          <span className="text-blue-600 flex items-center gap-1">
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            Syncing...
                          </span>
                        ) : customStoreSyncStatus === 'partial_failed' ? (
                          <span className="text-amber-800 flex items-center gap-1 text-xs">
                            <AlertCircle className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                            Partial Sync
                          </span>
                        ) : customStoreLastSyncedAt ? (
                          new Date(customStoreLastSyncedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
                        ) : (
                          'Ready'
                        )}
                      </div>
                      <span className="text-[11px] text-slate-500 block mt-0.5">
                        {customStoreLastSyncedAt ? new Date(customStoreLastSyncedAt).toLocaleDateString() : 'Sync ready'}
                      </span>
                    </div>
                  </div>

                  <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-3 text-xs">
                    <div className="font-bold text-slate-900 flex items-center gap-2">
                      <Key className="w-3.5 h-3.5 text-indigo-600" />
                      <span>API & Webhook Invariants</span>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-slate-600 font-mono text-[11px]">
                      <div className="bg-white p-2.5 rounded-lg border border-slate-200">
                        <span className="text-slate-400 block text-[10px] uppercase font-sans font-bold">API Base URL</span>
                        <span className="truncate block text-slate-800">{customStoreApiUrl}</span>
                      </div>
                      <div className="bg-white p-2.5 rounded-lg border border-slate-200">
                        <span className="text-slate-400 block text-[10px] uppercase font-sans font-bold">Stored Key (Encrypted)</span>
                        <span className="text-slate-800">{customStoreMaskedKey || '••••••••••••'}</span>
                      </div>
                      <div className="bg-white p-2.5 rounded-lg border border-slate-200">
                        <span className="text-slate-400 block text-[10px] uppercase font-sans font-bold">Inbound Webhook URL</span>
                        <span className="text-slate-800 truncate block">/api/custom-store/webhooks</span>
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                /* Connect Custom Store Form */
                <form onSubmit={handleSaveCustomStore} className="space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
                    <div>
                      <label className="block font-semibold text-slate-700 mb-1">
                        Store Name <span className="text-rose-500">*</span>
                      </label>
                      <input
                        type="text"
                        placeholder="e.g. Apex Horology Demo"
                        value={customStoreName}
                        onChange={(e) => setCustomStoreName(e.target.value)}
                        required
                        className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 focus:bg-white focus:ring-2 focus:ring-indigo-500 focus:outline-hidden"
                      />
                    </div>

                    <div>
                      <label className="block font-semibold text-slate-700 mb-1">
                        Website Public URL <span className="text-rose-500">*</span>
                      </label>
                      <input
                        type="url"
                        placeholder="https://apex-store.example.com"
                        value={customStoreWebsite}
                        onChange={(e) => setCustomStoreWebsite(e.target.value)}
                        required
                        className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 focus:bg-white focus:ring-2 focus:ring-indigo-500 focus:outline-hidden"
                      />
                    </div>

                    <div className="sm:col-span-2">
                      <label className="block font-semibold text-slate-700 mb-1">
                        API Base URL <span className="text-rose-500">*</span>
                      </label>
                      <input
                        type="url"
                        placeholder="https://api.apex-store.example.com/api/v1 (or http://localhost:3000/api/demo-custom-store/v1)"
                        value={customStoreApiUrl}
                        onChange={(e) => setCustomStoreApiUrl(e.target.value)}
                        required
                        className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 font-mono text-xs focus:bg-white focus:ring-2 focus:ring-indigo-500 focus:outline-hidden"
                      />
                      <p className="text-[11px] text-slate-500 mt-1">
                        Must implement the versioned endpoints: <code className="font-mono bg-slate-100 px-1 py-0.5 rounded">/store</code>, <code className="font-mono bg-slate-100 px-1 py-0.5 rounded">/products</code>, and <code className="font-mono bg-slate-100 px-1 py-0.5 rounded">/orders</code>.
                      </p>
                    </div>

                    <div>
                      <label className="block font-semibold text-slate-700 mb-1">
                        API Key / Bearer Token <span className="text-rose-500">*</span>
                      </label>
                      <input
                        type="password"
                        placeholder="Enter API key or Bearer token"
                        value={customStoreApiKey}
                        onChange={(e) => setCustomStoreApiKey(e.target.value)}
                        required={!customStoreConnected}
                        className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 font-mono text-xs focus:bg-white focus:ring-2 focus:ring-indigo-500 focus:outline-hidden"
                      />
                      <p className="text-[11px] text-slate-500 mt-1">
                        Encrypted with AES-256-GCM. Never returned in plaintext.
                      </p>
                    </div>

                    <div>
                      <label className="block font-semibold text-slate-700 mb-1">
                        Webhook Signing Secret (Optional)
                      </label>
                      <input
                        type="password"
                        placeholder="Secret for HMAC-SHA256 signature verification"
                        value={customStoreWebhookSecret}
                        onChange={(e) => setCustomStoreWebhookSecret(e.target.value)}
                        className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 font-mono text-xs focus:bg-white focus:ring-2 focus:ring-indigo-500 focus:outline-hidden"
                      />
                      <p className="text-[11px] text-slate-500 mt-1">
                        Used to verify real-time events sent to <code className="font-mono bg-slate-100 px-1 py-0.5 rounded">/api/custom-store/webhooks</code>.
                      </p>
                    </div>
                  </div>

                  <div className="pt-2 flex flex-wrap items-center justify-between gap-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          const origin = typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000';
                          setCustomStoreName('The Baby Supply');
                          setCustomStoreWebsite('https://thebabysupply.nl');
                          setCustomStoreApiUrl(`${origin}/api/the-baby-supply/v1`);
                          setCustomStoreApiKey('tbs-live-key-baby2026');
                          setCustomStoreWebhookSecret('tbs-webhook-secret-baby99');
                        }}
                        className="px-3 py-1.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 text-xs font-semibold rounded-lg border border-emerald-300 transition-colors cursor-pointer"
                      >
                        ⚡ Quick-Fill The Baby Supply (NL)
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          const origin = typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000';
                          setCustomStoreName('Apex Horology Demo');
                          setCustomStoreWebsite(`${origin}/demo-store`);
                          setCustomStoreApiUrl(`${origin}/api/demo-custom-store/v1`);
                          setCustomStoreApiKey('demo-custom-key-123');
                          setCustomStoreWebhookSecret('demo-custom-webhook-secret-456');
                        }}
                        className="px-3 py-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 text-xs font-semibold rounded-lg border border-indigo-200 transition-colors cursor-pointer"
                      >
                        ⚡ Mock Custom Store (Apex)
                      </button>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={handleTestCustomStore}
                        disabled={testingCustomStore || !customStoreApiUrl || (!customStoreApiKey && !customStoreConnected)}
                        className="px-4 py-2 bg-white hover:bg-slate-50 border border-slate-200 text-slate-700 text-xs font-semibold rounded-xl transition-colors cursor-pointer disabled:opacity-50 flex items-center gap-1.5"
                      >
                        {testingCustomStore ? <Loader2 className="w-3.5 h-3.5 animate-spin text-indigo-600" /> : <Link2 className="w-3.5 h-3.5" />}
                        <span>Test Connection</span>
                      </button>

                      <button
                        type="submit"
                        disabled={savingCustomStore}
                        className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-xs font-bold rounded-xl shadow-xs transition-colors flex items-center gap-1.5 cursor-pointer"
                      >
                        {savingCustomStore ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                        <span>Save & Connect Custom Store</span>
                      </button>
                    </div>
                  </div>
                </form>
              )}
            </div>

            {/* 1. Shopify Storefront Connector Card */}
            <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-xs space-y-6">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="flex items-start sm:items-center gap-3.5 flex-1 min-w-0">
                  <div className="w-12 h-12 rounded-2xl bg-emerald-50 border border-emerald-200 flex items-center justify-center text-emerald-600 shadow-xs shrink-0">
                    <ShoppingBag className="w-6 h-6" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-bold text-slate-900 flex flex-wrap items-center gap-2">
                      <span>Shopify Store Integration</span>
                      {shopifyConnected ? (
                        shopifySyncStatus === 'partial_failed' || (shopifyLastError && (shopifyLastError.includes('order access blocked') || shopifyLastError.includes('protected customer data') || shopifyLastError.includes('REST endpoints with protected customer data'))) ? (
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-amber-100 text-amber-900 border border-amber-300 break-words">
                            <AlertCircle className="w-3 h-3 text-amber-600 shrink-0" />
                            Products synced; order access blocked
                          </span>
                        ) : shopifySyncStatus === 'failed' ? (
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-rose-100 text-rose-800 border border-rose-200">
                            <AlertCircle className="w-3 h-3 text-rose-600 shrink-0" />
                            Sync Failed
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-200">
                            <CheckCircle2 className="w-3 h-3 text-emerald-600 shrink-0" />
                            Connected & Synced
                          </span>
                        )
                      ) : (
                        <span className="px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-slate-100 text-slate-600 border border-slate-200">
                          Not Connected
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">
                      Connect your Shopify store to automatically sync products, variants, prices, inventory, store policies, and customer order tracking.
                    </p>
                  </div>
                </div>

                {shopifyConnected && (
                  <div className="flex flex-wrap items-center gap-2 self-start sm:self-auto shrink-0">
                    <button
                      type="button"
                      onClick={handleSyncShopify}
                      disabled={syncingShopify}
                      className="px-3.5 py-2 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 text-emerald-800 text-xs font-semibold rounded-xl transition-colors cursor-pointer flex items-center gap-1.5"
                    >
                      <RefreshCw
                        className={`w-3.5 h-3.5 ${syncingShopify ? 'animate-spin text-emerald-600' : 'text-emerald-700'}`}
                      />
                      <span>{syncingShopify ? 'Syncing Store...' : 'Sync Store Now'}</span>
                    </button>
                    <button
                      type="button"
                      onClick={handleDisconnectShopify}
                      disabled={disconnectingShopify}
                      className="px-3.5 py-2 bg-white hover:bg-rose-50 border border-slate-200 hover:border-rose-200 text-rose-600 text-xs font-semibold rounded-xl transition-colors cursor-pointer flex items-center gap-1.5"
                    >
                      {disconnectingShopify ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <X className="w-3.5 h-3.5" />}
                      <span>Disconnect</span>
                    </button>
                  </div>
                )}
              </div>

              {/* Shopify Connection Details or Connect Form */}
              {shopifyConnected ? (
                <div className="space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
                    <div className="p-4 rounded-xl bg-slate-50 border border-slate-200">
                      <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider block">
                        Connected Store
                      </span>
                      <div className="font-bold text-slate-900 text-sm mt-1 truncate">
                        {shopifyName || shopifyDomain}
                      </div>
                      <span className="text-[11px] text-slate-500 font-mono block mt-0.5 truncate">
                        {shopifyDomain}
                      </span>
                    </div>

                    <div className="p-4 rounded-xl bg-slate-50 border border-slate-200">
                      <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider block">
                        Synced Products
                      </span>
                      <div className="font-bold text-slate-900 text-sm mt-1">
                        {shopifyProductCount} Products
                      </div>
                      <span className="text-[11px] text-emerald-600 font-semibold block mt-0.5">
                        ✓ In Stock & Grounded
                      </span>
                    </div>

                    <div className="p-4 rounded-xl bg-slate-50 border border-slate-200">
                      <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider block">
                        Synced Orders
                      </span>
                      <div className="font-bold text-slate-900 text-sm mt-1 flex items-center gap-1.5">
                        <span>{shopifyOrderCount} Orders</span>
                        {shopifyOrderCount === 0 && (shopifySyncStatus === 'partial_failed' || (shopifyLastError && (shopifyLastError.includes('order access blocked') || shopifyLastError.includes('protected customer data') || shopifyLastError.includes('REST endpoints with protected customer data')))) && (
                          <span className="px-1.5 py-0.2 rounded text-[10px] bg-amber-100 text-amber-800 font-semibold border border-amber-200">
                            Access Blocked
                          </span>
                        )}
                      </div>
                      <span className="text-[11px] text-slate-500 font-medium block mt-0.5">
                        {(shopifySyncStatus === 'partial_failed' || (shopifyLastError && (shopifyLastError.includes('order access blocked') || shopifyLastError.includes('protected customer data') || shopifyLastError.includes('REST endpoints with protected customer data'))))
                          ? 'PCD Approval Required'
                          : 'Live Tracking Grounding'}
                      </span>
                    </div>

                    <div className="p-4 rounded-xl bg-slate-50 border border-slate-200">
                      <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider block">
                        Last Store Sync
                      </span>
                      <div className="font-bold text-slate-900 text-sm mt-1">
                        {syncingShopify || shopifySyncStatus === 'syncing' ? (
                          <span className="text-blue-600 flex items-center gap-1">
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            Syncing...
                          </span>
                        ) : shopifySyncStatus === 'partial_failed' ? (
                          <span className="text-amber-800 flex items-center gap-1 text-xs">
                            <AlertCircle className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                            Partial Sync
                          </span>
                        ) : shopifyLastSyncedAt ? (
                          new Date(shopifyLastSyncedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
                        ) : (
                          'Active'
                        )}
                      </div>
                      <span className="text-[11px] text-slate-500 block mt-0.5">
                        {shopifyLastSyncedAt ? new Date(shopifyLastSyncedAt).toLocaleDateString() : 'Continuous sync'}
                      </span>
                    </div>
                  </div>

                  {/* Sync status notice */}
                  {(shopifySyncStatus === 'partial_failed' || (shopifyLastError && (shopifyLastError.includes('order access blocked') || shopifyLastError.includes('protected customer data') || shopifyLastError.includes('REST endpoints with protected customer data')))) ? (
                    <div className="p-4 rounded-xl bg-amber-50 border border-amber-200 text-amber-950 text-xs space-y-1.5 shadow-xs">
                      <div className="flex items-center gap-2 font-bold text-amber-900">
                        <AlertCircle className="w-4 h-4 text-amber-600 shrink-0" />
                        <span>Products Synced; Order Access Blocked by Shopify</span>
                      </div>
                      <p className="text-amber-800 text-[11px] leading-relaxed">
                        Your product catalog ({shopifyProductCount} items) and store policies are fully synced and powering AI customer replies. However, Shopify has restricted access to live customer orders because this app has not yet been approved for <strong>Protected Customer Data (PCD)</strong> in the Shopify Partner Dashboard.
                      </p>
                      <div className="pt-1 text-[11px] text-amber-900 leading-relaxed">
                        <strong>To enable live order tracking:</strong> In your Shopify Partner Dashboard, open <em>Apps → [Your App] → App Setup → Protected customer data</em> and request permission to access customer details on orders. In the meantime, manual demo orders and customer email privacy checks remain fully active.
                      </div>
                    </div>
                  ) : shopifyLastError ? (
                    <div className="p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-900 text-xs flex items-start gap-2.5">
                      <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                      <div>
                        <span className="font-bold block">Sync Status Notice:</span>
                        <span>{shopifyLastError}</span>
                      </div>
                    </div>
                  ) : null}

                  <div className="p-4 rounded-xl bg-emerald-50/50 border border-emerald-100 text-xs text-emerald-900 flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                    <span>
                      <strong>Store Catalog & Policies Connected:</strong> Manual product and FAQ entry is not required. AI inquiries for pricing, availability, tracking, and return rules are grounded directly in your live store data.
                    </span>
                  </div>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="p-5 rounded-2xl bg-slate-50 border border-slate-200 space-y-4">
                    <div>
                      <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider">
                        Connect Your Shopify Store
                      </h3>
                      <p className="text-xs text-slate-500 mt-0.5">
                        Each business organization connects its own store. We request only read permissions for products, orders, inventory, and policies.
                      </p>
                    </div>

                    <div className="flex flex-col sm:flex-row items-center gap-3">
                      <div className="relative flex-1 w-full">
                        <input
                          type="text"
                          value={connectShopInput}
                          onChange={(e) => setConnectShopInput(e.target.value)}
                          placeholder="e.g. my-clothing-brand.myshopify.com"
                          className="w-full pl-3 pr-24 py-2.5 bg-white border border-slate-300 rounded-xl text-xs text-slate-900 focus:ring-2 focus:ring-emerald-500 focus:outline-hidden"
                        />
                        <span className="absolute right-3 top-2.5 text-xs text-slate-400 font-mono pointer-events-none">
                          .myshopify.com
                        </span>
                      </div>

                      <button
                        type="button"
                        onClick={handleConnectShopify}
                        disabled={connectingShopify || !connectShopInput.trim()}
                        className="w-full sm:w-auto px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-xs font-bold rounded-xl shadow-xs transition-all flex items-center justify-center gap-2 cursor-pointer shrink-0"
                      >
                        {connectingShopify ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <ShoppingBag className="w-4 h-4" />
                        )}
                        <span>{connectingShopify ? 'Initiating OAuth...' : 'Connect Shopify'}</span>
                      </button>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-2 border-t border-slate-200/80 text-[11px] text-slate-600">
                      <div className="flex items-center gap-1.5">
                        <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
                        <span>Encrypted AES-256-GCM Tokens</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <Check className="w-3.5 h-3.5 text-emerald-600" />
                        <span>Read-Only Store Scopes</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <Layers className="w-3.5 h-3.5 text-emerald-600" />
                        <span>Isolated Tenant Multi-Store</span>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* 2. Gmail & Mailbox Card */}
            <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-xs space-y-6">
              <div>
                <h2 className="text-sm font-bold text-slate-900">
                  Email Mailbox & Gmail Sync
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Connect your business Gmail account to automatically sync customer emails and send replies.
                </p>
              </div>

              {/* Gmail Connection Card */}
              <div className="p-5 rounded-2xl border border-slate-200 bg-slate-50 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="flex items-center gap-3.5">
                  <div className="w-10 h-10 rounded-xl bg-white border border-slate-200 flex items-center justify-center text-red-500 shadow-xs">
                    <Mail className="w-5 h-5" />
                  </div>
                  <div>
                    <div className="text-xs font-bold text-slate-900 flex items-center gap-2">
                      <span>Google Gmail Mailbox</span>
                      <span
                        className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                          gmailConnected
                            ? 'bg-emerald-100 text-emerald-800'
                            : 'bg-amber-100 text-amber-800'
                        }`}
                      >
                        {gmailConnected ? 'Connected' : 'Simulation Mode Active'}
                      </span>
                    </div>
                    <p className="text-xs text-slate-500 mt-0.5">
                      {gmailConnected
                        ? `Connected to ${gmailEmail} (${gmailName || 'Store Mailbox'})`
                        : 'Syncing in simulated sandbox mode. Connect your Gmail to enable live sending.'}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleSyncGmail}
                    disabled={syncingGmail}
                    className="px-3.5 py-2 bg-white hover:bg-slate-100 border border-slate-200 text-slate-700 text-xs font-semibold rounded-xl transition-colors cursor-pointer flex items-center gap-1.5"
                  >
                    <RefreshCw
                      className={`w-3.5 h-3.5 ${syncingGmail ? 'animate-spin text-indigo-600' : ''}`}
                    />
                    <span>{syncingGmail ? 'Syncing...' : 'Sync Now'}</span>
                  </button>
                  <a
                    href="/api/auth/google/login"
                    className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold rounded-xl shadow-xs transition-colors"
                  >
                    {gmailConnected ? 'Reconnect Gmail' : 'Connect Gmail'}
                  </a>
                </div>
              </div>

              <div className="text-xs">
                <label className="block font-semibold text-slate-700 mb-1">
                  Customer Support Sender Email
                </label>
                <input
                  type="email"
                  value={supportEmail}
                  onChange={(e) => setSupportEmail(e.target.value)}
                  className="w-full max-w-md p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 focus:bg-white focus:ring-2 focus:ring-indigo-500 focus:outline-hidden"
                />
              </div>
            </div>
          </div>
        )}

        {/* TAB 4: Store Knowledge & Catalog */}
        {activeTab === 'knowledge' && (
          <div className="space-y-6">
            {/* Shopify Live Sync Status Notice */}
            {shopifyConnected ? (
              <div className="p-4 rounded-2xl bg-emerald-50 border border-emerald-200 text-xs text-emerald-950 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-xs">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl bg-emerald-100 flex items-center justify-center text-emerald-700 shrink-0">
                    <ShoppingBag className="w-4 h-4" />
                  </div>
                  <div>
                    <div className="font-bold flex items-center gap-2">
                      <span>Live Shopify Sync Active ({shopifyDomain})</span>
                      <span className="px-2 py-0.5 rounded-full text-[10px] bg-emerald-200 text-emerald-900 font-bold">
                        {shopifyProductCount} Products Synced
                      </span>
                    </div>
                    <p className="text-emerald-800 text-[11px] mt-0.5">
                      Store products, prices, stock quantities, and policies are synchronized automatically from Shopify. Manual entry below is optional and serves as fallback/overrides.
                    </p>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={handleSyncShopify}
                  disabled={syncingShopify}
                  className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl flex items-center gap-1.5 shrink-0 text-xs shadow-xs cursor-pointer"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${syncingShopify ? 'animate-spin' : ''}`} />
                  <span>{syncingShopify ? 'Syncing...' : 'Sync Catalog'}</span>
                </button>
              </div>
            ) : (
              <div className="p-4 rounded-2xl bg-indigo-50/70 border border-indigo-100 text-xs text-indigo-950 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  <ShoppingBag className="w-4 h-4 text-indigo-600 shrink-0" />
                  <span>
                    <strong>Want automated catalog & policy sync?</strong> Connect your Shopify store under <button type="button" onClick={() => setActiveTab('integrations')} className="font-bold text-indigo-700 underline cursor-pointer">Integrations</button> to skip manual entry.
                  </span>
                </div>
              </div>
            )}

            {/* Store Policies */}
            <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-xs space-y-4">
              <div>
                <h2 className="text-sm font-bold text-slate-900">
                  Store Policies
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  The AI uses these verified policies when answering customer questions.
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    Return / Exchange Window (Days)
                  </label>
                  <input
                    type="number"
                    value={returnWindowDays}
                    onChange={(e) => setReturnWindowDays(Number(e.target.value))}
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-900"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    Shipping Timeframe
                  </label>
                  <input
                    type="text"
                    value={shippingTimeframe}
                    onChange={(e) => setShippingTimeframe(e.target.value)}
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-900"
                  />
                </div>
              </div>
            </div>

            {/* FAQs List */}
            <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-xs space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-sm font-bold text-slate-900">
                    Frequently Asked Questions (FAQs)
                  </h2>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Common questions that the AI answers automatically.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() =>
                    setFaqs([
                      ...faqs,
                      {
                        id: `faq-${Date.now()}`,
                        question: 'What payment methods do you accept?',
                        answer: 'We accept Cash on Delivery, Bank Transfer, and major Credit Cards.',
                      },
                    ])
                  }
                  className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold rounded-xl flex items-center gap-1.5 cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Add FAQ</span>
                </button>
              </div>

              <div className="space-y-3">
                {faqs.map((faq, idx) => (
                  <div
                    key={faq.id || idx}
                    className="p-4 rounded-xl border border-slate-200 bg-slate-50/50 space-y-2 text-xs"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <input
                        type="text"
                        value={faq.question}
                        onChange={(e) => {
                          const updated = [...faqs];
                          updated[idx].question = e.target.value;
                          setFaqs(updated);
                        }}
                        placeholder="Customer Question"
                        className="flex-1 p-2 bg-white border border-slate-200 rounded-lg font-semibold text-slate-900"
                      />
                      <button
                        type="button"
                        onClick={() => setFaqs(faqs.filter((_, i) => i !== idx))}
                        className="text-rose-500 hover:text-rose-700 p-1.5 rounded-lg hover:bg-rose-50 cursor-pointer"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                    <textarea
                      value={faq.answer}
                      onChange={(e) => {
                        const updated = [...faqs];
                        updated[idx].answer = e.target.value;
                        setFaqs(updated);
                      }}
                      placeholder="Verified Answer"
                      rows={2}
                      className="w-full p-2 bg-white border border-slate-200 rounded-lg text-slate-700 resize-none"
                    />
                  </div>
                ))}
              </div>
            </div>

            {/* Merchant-Managed Product Catalog & Pricing */}
            <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-xs space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div>
                  <h2 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                    <Tag className="w-4 h-4 text-indigo-600" />
                    <span>Merchant Product Catalog & Inventory</span>
                  </h2>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Add and manage products with SKU, prices, stock quantities, and sizes/variants for AI availability answers.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() =>
                    setProducts([
                      ...products,
                      {
                        id: `prod-${Date.now()}`,
                        name: 'New Product',
                        sku: `SKU-${Math.floor(1000 + Math.random() * 9000)}`,
                        price: 3500,
                        currency: currency || 'PKR',
                        stock_quantity: 20,
                        variants: 'Small, Medium, Large',
                        is_active: true,
                        in_stock: true,
                        description: 'Premium quality fabric and finish.',
                      },
                    ])
                  }
                  className="px-3.5 py-2 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 text-xs font-semibold rounded-xl flex items-center gap-1.5 cursor-pointer self-start sm:self-auto"
                >
                  <Plus className="w-4 h-4" />
                  <span>Add Product</span>
                </button>
              </div>

              {products.length === 0 ? (
                <div className="p-8 text-center bg-slate-50 rounded-xl border border-dashed border-slate-200 text-xs text-slate-500">
                  No products in catalog. Click &ldquo;Add Product&rdquo; above to create your first catalog item.
                </div>
              ) : (
                <div className="space-y-4">
                  {products.map((prod, idx) => (
                    <div
                      key={prod.id || idx}
                      className="p-4 rounded-xl border border-slate-200 bg-slate-50/50 space-y-3 text-xs"
                    >
                      {/* Top row: Name, SKU, Price, Active Status, Delete */}
                      <div className="grid grid-cols-1 sm:grid-cols-12 gap-2.5 items-center">
                        <div className="sm:col-span-4">
                          <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                            Product Name *
                          </label>
                          <input
                            type="text"
                            value={prod.name}
                            onChange={(e) => {
                              const updated = [...products];
                              updated[idx].name = e.target.value;
                              setProducts(updated);
                            }}
                            placeholder="e.g. Silk Kurti"
                            className="w-full p-2 bg-white border border-slate-200 rounded-lg font-semibold text-slate-900"
                            required
                          />
                        </div>

                        <div className="sm:col-span-2">
                          <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                            SKU
                          </label>
                          <input
                            type="text"
                            value={prod.sku || ''}
                            onChange={(e) => {
                              const updated = [...products];
                              updated[idx].sku = e.target.value;
                              setProducts(updated);
                            }}
                            placeholder="SKU-101"
                            className="w-full p-2 bg-white border border-slate-200 rounded-lg font-mono text-slate-700"
                          />
                        </div>

                        <div className="sm:col-span-2">
                          <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                            Price ({prod.currency || currency}) *
                          </label>
                          <input
                            type="number"
                            min="0"
                            step="any"
                            value={prod.price}
                            onChange={(e) => {
                              const updated = [...products];
                              updated[idx].price = Number(e.target.value);
                              setProducts(updated);
                            }}
                            placeholder="Price"
                            className="w-full p-2 bg-white border border-slate-200 rounded-lg font-semibold text-slate-900"
                            required
                          />
                        </div>

                        <div className="sm:col-span-2">
                          <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                            Stock Quantity
                          </label>
                          <input
                            type="number"
                            min="0"
                            value={prod.stock_quantity ?? (prod.in_stock !== false ? 10 : 0)}
                            onChange={(e) => {
                              const updated = [...products];
                              const qty = Number(e.target.value);
                              updated[idx].stock_quantity = qty;
                              updated[idx].in_stock = qty > 0;
                              setProducts(updated);
                            }}
                            placeholder="Qty"
                            className="w-full p-2 bg-white border border-slate-200 rounded-lg text-slate-900"
                          />
                        </div>

                        <div className="sm:col-span-2 flex items-center justify-between gap-2 pt-4 sm:pt-0">
                          <label className="flex items-center gap-1.5 text-xs text-slate-700 font-medium cursor-pointer">
                            <input
                              type="checkbox"
                              checked={prod.is_active !== false}
                              onChange={(e) => {
                                const updated = [...products];
                                updated[idx].is_active = e.target.checked;
                                setProducts(updated);
                              }}
                              className="accent-indigo-600 w-4 h-4 rounded"
                            />
                            <span className={prod.is_active !== false ? 'text-emerald-700 font-semibold' : 'text-slate-400'}>
                              {prod.is_active !== false ? 'Active' : 'Inactive'}
                            </span>
                          </label>

                          <button
                            type="button"
                            onClick={() => setProducts(products.filter((_, i) => i !== idx))}
                            className="text-rose-500 hover:text-rose-700 p-1.5 rounded-lg hover:bg-rose-50 cursor-pointer"
                            title="Delete product"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>

                      {/* Second row: Variants/Sizes & Description */}
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-1 border-t border-slate-100">
                        <div>
                          <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                            Sizes / Variants (comma separated)
                          </label>
                          <input
                            type="text"
                            value={
                              Array.isArray(prod.variants)
                                ? prod.variants.join(', ')
                                : (prod.variants || '')
                            }
                            onChange={(e) => {
                              const updated = [...products];
                              updated[idx].variants = e.target.value;
                              setProducts(updated);
                            }}
                            placeholder="e.g. Small, Medium, Large, XL / Black, Navy"
                            className="w-full p-2 bg-white border border-slate-200 rounded-lg text-slate-800"
                          />
                        </div>

                        <div>
                          <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                            Product Description / Details
                          </label>
                          <input
                            type="text"
                            value={prod.description || ''}
                            onChange={(e) => {
                              const updated = [...products];
                              updated[idx].description = e.target.value;
                              setProducts(updated);
                            }}
                            placeholder="e.g. 100% Cotton, 3-piece unstitched lawn suit."
                            className="w-full p-2 bg-white border border-slate-200 rounded-lg text-slate-800"
                          />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* TAB 5: Demo Orders Section */}
        {activeTab === 'demo_orders' && (
          <div className="space-y-6">
            <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-xs space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="text-sm font-bold text-slate-900">
                      Demo Store Orders Management
                    </h2>
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-purple-100 text-purple-800">
                      Demo Mode
                    </span>
                  </div>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Create and manage simulated orders for testing AI order status replies and customer verification privacy gates.
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={fetchOrders}
                    disabled={loadingOrders}
                    className="px-3 py-1.5 bg-white border border-slate-200 text-slate-700 text-xs font-semibold rounded-xl hover:bg-slate-50 flex items-center gap-1.5 cursor-pointer"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${loadingOrders ? 'animate-spin text-indigo-600' : ''}`} />
                    <span>Refresh</span>
                  </button>
                  <button
                    type="button"
                    onClick={openCreateOrderModal}
                    className="px-3.5 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold rounded-xl flex items-center gap-1.5 shadow-xs cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Create Demo Order</span>
                  </button>
                </div>
              </div>

              {/* Order List Table */}
              {loadingOrders ? (
                <div className="p-8 text-center text-xs text-slate-500 flex items-center justify-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin text-indigo-600" />
                  <span>Loading demo orders...</span>
                </div>
              ) : orders.length === 0 ? (
                <div className="p-8 text-center bg-slate-50 rounded-xl border border-dashed border-slate-200 text-xs text-slate-500 space-y-2">
                  <p>No orders found for this store.</p>
                  <button
                    type="button"
                    onClick={openCreateOrderModal}
                    className="px-3 py-1.5 bg-indigo-600 text-white font-semibold rounded-lg text-xs"
                  >
                    Create Your First Demo Order
                  </button>
                </div>
              ) : (
                <div className="overflow-x-auto border border-slate-200 rounded-xl">
                  <table className="w-full text-left text-xs text-slate-700">
                    <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 font-bold uppercase text-[10px]">
                      <tr>
                        <th className="p-3">Order ID</th>
                        <th className="p-3">Customer</th>
                        <th className="p-3">Items & Variants</th>
                        <th className="p-3">Total</th>
                        <th className="p-3">Status</th>
                        <th className="p-3">Tracking</th>
                        <th className="p-3 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 bg-white">
                      {orders.map((ord) => {
                        const rawItems = ord.items || ord.data?.items;
                        const items = Array.isArray(rawItems) && rawItems.length > 0 ? rawItems : [];
                        const data = ord.data || {};
                        const tracking = String(data.tracking_number || data.tracking || '—');
                        return (
                          <tr key={ord.order_id} className="hover:bg-slate-50/70">
                            <td className="p-3 font-mono font-bold text-indigo-700 whitespace-nowrap">
                              <div className="flex items-center gap-1.5">
                                <span>{ord.order_id}</span>
                                <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-purple-100 text-purple-700">
                                  Demo
                                </span>
                              </div>
                            </td>
                            <td className="p-3">
                              <div className="font-semibold text-slate-900">
                                {ord.customer_name || String(data.customer_name || 'Customer')}
                              </div>
                              <div className="text-[11px] text-slate-500 font-mono">
                                {ord.customer_email || String(data.customer_email || '—')}
                              </div>
                            </td>
                            <td className="p-3">
                              {items.length > 0 ? (
                                <div className="space-y-0.5">
                                  {items.map((it: any, i: number) => (
                                    <div key={i} className="text-slate-800">
                                      <span className="font-medium">{it.name || it.title || 'Item'}</span>
                                      {(it.variant || it.size) && (
                                        <span className="text-slate-500 text-[11px] ml-1 font-mono">
                                          [{it.variant || it.size}]
                                        </span>
                                      )}
                                      <span className="text-slate-500 text-[11px] ml-1">
                                        × {it.qty || it.quantity || 1}
                                      </span>
                                    </div>
                                  ))}
                                </div>
                              ) : (
                                <span className="text-slate-400">Standard items</span>
                              )}
                            </td>
                            <td className="p-3 font-bold text-slate-900 whitespace-nowrap">
                              {ord.currency || currency || 'PKR'} {ord.total || '0'}
                            </td>
                            <td className="p-3 whitespace-nowrap">
                              <span
                                className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${
                                  ord.status === 'delivered'
                                    ? 'bg-emerald-100 text-emerald-800'
                                    : ord.status === 'shipped'
                                    ? 'bg-blue-100 text-blue-800'
                                    : ord.status === 'processing'
                                    ? 'bg-amber-100 text-amber-800'
                                    : 'bg-slate-100 text-slate-700'
                                }`}
                              >
                                {ord.status || 'processing'}
                              </span>
                            </td>
                            <td className="p-3 font-mono text-[11px] text-slate-600 whitespace-nowrap">
                              {tracking}
                            </td>
                            <td className="p-3 text-right whitespace-nowrap">
                              <div className="flex items-center justify-end gap-1.5">
                                <button
                                  type="button"
                                  onClick={() => openEditOrderModal(ord)}
                                  className="p-1 text-slate-500 hover:text-indigo-600 rounded-md hover:bg-slate-100 cursor-pointer"
                                  title="Edit Demo Order"
                                >
                                  <Edit2 className="w-3.5 h-3.5" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleDeleteOrder(ord.order_id)}
                                  className="p-1 text-slate-500 hover:text-rose-600 rounded-md hover:bg-rose-50 cursor-pointer"
                                  title="Delete Demo Order"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}

        {/* 5. Expandable Advanced Technical Information */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
          <button
            type="button"
            onClick={() => setAdvancedOpen(!advancedOpen)}
            className="w-full p-4 flex items-center justify-between text-left text-xs font-semibold text-slate-600 hover:bg-slate-50 transition-colors cursor-pointer"
          >
            <div className="flex items-center gap-2 text-slate-700">
              <Terminal className="w-4 h-4 text-slate-400" />
              <span>Advanced Technical Information & Multi-Tenant Identifiers</span>
            </div>
            {advancedOpen ? (
              <ChevronUp className="w-4 h-4 text-slate-400" />
            ) : (
              <ChevronDown className="w-4 h-4 text-slate-400" />
            )}
          </button>

          {advancedOpen && (
            <div className="p-5 border-t border-slate-100 bg-slate-50/50 space-y-4 text-xs font-mono">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="p-3 bg-white border border-slate-200 rounded-xl">
                  <span className="text-[10px] text-slate-400 font-sans uppercase font-bold block mb-1">
                    Multi-Tenant Identifier
                  </span>
                  <span className="text-slate-800 font-bold">{tenantId}</span>
                </div>
                <div className="p-3 bg-white border border-slate-200 rounded-xl">
                  <span className="text-[10px] text-slate-400 font-sans uppercase font-bold block mb-1">
                    Default Approver User
                  </span>
                  <span className="text-slate-800 font-bold">{approverId}</span>
                </div>
                <div className="p-3 bg-white border border-slate-200 rounded-xl">
                  <span className="text-[10px] text-slate-400 font-sans uppercase font-bold block mb-1">
                    Database Schema
                  </span>
                  <span className="text-emerald-700">iao.businesses / iao.orders</span>
                </div>
                <div className="p-3 bg-white border border-slate-200 rounded-xl">
                  <span className="text-[10px] text-slate-400 font-sans uppercase font-bold block mb-1">
                    OAuth Scopes
                  </span>
                  <span className="text-slate-700 truncate block">gmail.readonly, gmail.send</span>
                </div>
              </div>

              <div className="p-3 bg-slate-900 text-emerald-400 rounded-xl overflow-x-auto text-[11px]">
                <pre>{JSON.stringify(businessRecord?.settings || {}, null, 2)}</pre>
              </div>
            </div>
          )}
        </div>
      </form>

      {/* Modal: Create / Edit Demo Order */}
      {orderModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-xs p-4">
          <div className="bg-white rounded-2xl shadow-xl border border-slate-200 w-full max-w-lg overflow-hidden animate-in fade-in zoom-in-95">
            <div className="p-5 border-b border-slate-100 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Package className="w-5 h-5 text-indigo-600" />
                <h3 className="font-bold text-sm text-slate-900">
                  {editingOrder ? `Edit Demo Order (${orderForm.order_id})` : 'Create Demo Order'}
                </h3>
                <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-purple-100 text-purple-700">
                  Demo
                </span>
              </div>
              <button
                type="button"
                onClick={() => setOrderModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-lg"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveOrder} className="p-5 space-y-4 text-xs">
              {orderMessage && (
                <div
                  className={`p-3 rounded-xl font-semibold flex items-center gap-2 ${
                    orderMessage.type === 'success'
                      ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                      : 'bg-rose-50 text-rose-800 border border-rose-200'
                  }`}
                >
                  {orderMessage.type === 'success' ? (
                    <Check className="w-4 h-4 text-emerald-600" />
                  ) : (
                    <AlertCircle className="w-4 h-4 text-rose-600" />
                  )}
                  <span>{orderMessage.text}</span>
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    Order ID *
                  </label>
                  <input
                    type="text"
                    value={orderForm.order_id}
                    onChange={(e) => setOrderForm({ ...orderForm, order_id: e.target.value })}
                    placeholder="e.g. ORD-9801"
                    className="w-full p-2 bg-slate-50 border border-slate-200 rounded-lg font-mono font-bold text-slate-900"
                    required
                  />
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    Delivery Status
                  </label>
                  <select
                    value={orderForm.status}
                    onChange={(e) => setOrderForm({ ...orderForm, status: e.target.value })}
                    className="w-full p-2 bg-slate-50 border border-slate-200 rounded-lg text-slate-900"
                  >
                    <option value="pending">Pending</option>
                    <option value="processing">Processing</option>
                    <option value="shipped">Shipped</option>
                    <option value="delivered">Delivered</option>
                    <option value="cancelled">Cancelled</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    Customer Name
                  </label>
                  <input
                    type="text"
                    value={orderForm.customer_name}
                    onChange={(e) => setOrderForm({ ...orderForm, customer_name: e.target.value })}
                    placeholder="e.g. Ahmed Khan"
                    className="w-full p-2 bg-slate-50 border border-slate-200 rounded-lg text-slate-900"
                  />
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    Customer Email * (Privacy Matching)
                  </label>
                  <input
                    type="email"
                    value={orderForm.customer_email}
                    onChange={(e) => setOrderForm({ ...orderForm, customer_email: e.target.value })}
                    placeholder="e.g. customer@example.com"
                    className="w-full p-2 bg-slate-50 border border-slate-200 rounded-lg text-slate-900"
                    required
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    Product Name
                  </label>
                  <input
                    type="text"
                    value={orderForm.product_name}
                    onChange={(e) => setOrderForm({ ...orderForm, product_name: e.target.value })}
                    placeholder="e.g. Embroidered Lawn Kurti"
                    className="w-full p-2 bg-slate-50 border border-slate-200 rounded-lg text-slate-900"
                  />
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    Size / Variant
                  </label>
                  <input
                    type="text"
                    value={orderForm.variant}
                    onChange={(e) => setOrderForm({ ...orderForm, variant: e.target.value })}
                    placeholder="e.g. Medium / Blue"
                    className="w-full p-2 bg-slate-50 border border-slate-200 rounded-lg text-slate-900"
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    Quantity
                  </label>
                  <input
                    type="number"
                    min="1"
                    value={orderForm.quantity}
                    onChange={(e) => {
                      const q = Number(e.target.value) || 1;
                      setOrderForm({
                        ...orderForm,
                        quantity: q,
                        total: q * orderForm.unit_price,
                      });
                    }}
                    className="w-full p-2 bg-slate-50 border border-slate-200 rounded-lg text-slate-900"
                  />
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    Total Amount
                  </label>
                  <input
                    type="number"
                    min="0"
                    value={orderForm.total}
                    onChange={(e) => setOrderForm({ ...orderForm, total: Number(e.target.value) })}
                    className="w-full p-2 bg-slate-50 border border-slate-200 rounded-lg font-semibold text-slate-900"
                  />
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    Currency
                  </label>
                  <select
                    value={orderForm.currency}
                    onChange={(e) => setOrderForm({ ...orderForm, currency: e.target.value })}
                    className="w-full p-2 bg-slate-50 border border-slate-200 rounded-lg text-slate-900"
                  >
                    <option value="PKR">PKR</option>
                    <option value="USD">USD</option>
                    <option value="EUR">EUR</option>
                    <option value="GBP">GBP</option>
                    <option value="AED">AED</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Tracking Number / Courier Ref
                </label>
                <input
                  type="text"
                  value={orderForm.tracking_number}
                  onChange={(e) => setOrderForm({ ...orderForm, tracking_number: e.target.value })}
                  placeholder="e.g. TRK-PK-98231 (TCS / Leopard / DHL)"
                  className="w-full p-2 bg-slate-50 border border-slate-200 rounded-lg font-mono text-slate-900"
                />
              </div>

              <div className="pt-3 border-t border-slate-100 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setOrderModalOpen(false)}
                  className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold rounded-xl cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={orderSaving}
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl flex items-center gap-1.5 shadow-xs cursor-pointer"
                >
                  {orderSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                  <span>{orderSaving ? 'Saving...' : 'Save Demo Order'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </AppLayout>
  );
}
