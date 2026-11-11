import { BusinessSettings, ConversationRecord, MessageRecord } from './types';
import { getServerConfig } from './config';

interface DraftContext {
  conversation: ConversationRecord;
  history: MessageRecord[];
  settings: BusinessSettings;
  instructions?: string;
}

export async function generateAiReplyDraft(context: DraftContext): Promise<string> {
  const { conversation, history, settings, instructions } = context;
  const businessName = settings.business_name || 'Our Company';
  const tone = settings.tone || 'Professional, courteous, and helpful';
  const industry = settings.industry || 'ecommerce';

  // 1. Compile FAQs context
  const faqsText = (settings.knowledge?.faqs || [])
    .map((f, i) => `Q${i + 1}: ${f.question}\nA: ${f.answer}`)
    .join('\n\n');

  // 2. Compile Policies context
  const policies = settings.knowledge?.policies || {};
  const policiesList: string[] = [];
  if (policies.general_rules) policiesList.push(`General Rules: ${policies.general_rules}`);
  if (policies.operating_disclaimer) policiesList.push(`Disclaimer: ${policies.operating_disclaimer}`);
  if (policies.return_window_days) policiesList.push(`Return Window: ${policies.return_window_days} days from delivery`);
  if (policies.restocking_fee_pct) policiesList.push(`Restocking Fee: ${policies.restocking_fee_pct}%`);
  if (policies.cancellation_notice_hours) policiesList.push(`Cancellation Notice: ${policies.cancellation_notice_hours} hours required`);

  const policiesText = policiesList.join('\n');

  // 3. Compile Products/Services context
  const servicesList: string[] = [];
  if (Array.isArray(settings.knowledge?.services) && settings.knowledge.services.length > 0) {
    settings.knowledge.services.forEach((s) => {
      const priceStr = s.price_type === 'quote_required'
        ? 'Custom Quote Required'
        : s.price_type === 'starting_at'
        ? `Starts at $${s.price || 0}`
        : `$${s.price || 0}`;
      servicesList.push(`- ${s.name}: ${priceStr} (${s.description || 'Standard service'})`);
    });
  }
  if (Array.isArray(settings.knowledge?.products_services) && settings.knowledge.products_services.length > 0) {
    settings.knowledge.products_services.slice(0, 10).forEach((p) => {
      servicesList.push(`- ${p.name} (${p.sku || 'N/A'}): ${p.currency || settings.currency} ${p.price || 0} - ${p.description || ''}`);
    });
  }
  const catalogText = servicesList.join('\n');

  // Service Areas
  const serviceAreasList = (settings.knowledge?.service_areas || []).map((a) => a.name);
  const serviceAreasText = serviceAreasList.join(', ');

  // 4. Compile recent conversation history
  const historyText = history
    .map((m) => `[${m.sender_type.toUpperCase()} - ${m.sender_name}]: ${m.body}`)
    .join('\n\n');

  const customerName = conversation.customer_name || 'Customer';

  // Check if GROQ_API_KEY is available in environment
  const groqApiKey = process.env.GROQ_API_KEY;
  if (groqApiKey && groqApiKey.startsWith('gsk_')) {
    try {
      const prompt = `You are the AI Operations Assistant for "${businessName}" (Industry: ${industry}).
Draft a direct, helpful, and polite reply to the customer inquiry below.

BUSINESS IDENTITY & RULES:
- Business Name: ${businessName}
- Communication Tone: ${tone}
- Working Hours: ${settings.working_hours?.start_time || '09:00'} - ${settings.working_hours?.end_time || '18:00'} (${settings.timezone || 'UTC'})
- Service Areas Covered: ${serviceAreasText || 'Local service area'}

BUSINESS POLICIES:
${policiesText || 'Standard customer satisfaction guarantees apply.'}

KNOWLEDGE BASE & FAQS:
${faqsText || 'No specific FAQs provided.'}

APPROVED SERVICE CATALOG & PRICING:
${catalogText || 'Standard offerings.'}

CONVERSATION HISTORY:
${historyText}

ADDITIONAL OPERATOR INSTRUCTIONS:
${instructions || 'Address the customer inquiry clearly adhering to company policies.'}

STRICT SAFETY CONSTRAINTS:
1. NEVER confirm or execute financial refunds, stock reorders, or payment cancellations. Only explain policies or state that a representative is reviewing specific requests.
2. Maintain the requested tone (${tone}).
3. Address the customer by name (${customerName}).
4. Output ONLY the reply message text suitable to send to the customer. No preamble, no meta-explanation, no markdown quotes around the message.`;

      const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${groqApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'llama-3.3-70b-versatile',
          messages: [
            { role: 'system', content: 'You are an AI customer support assistant drafting replies for business owner approval.' },
            { role: 'user', content: prompt }
          ],
          temperature: 0.3,
          max_tokens: 600,
        }),
      });

      if (response.ok) {
        const data = await response.json();
        const text = data?.choices?.[0]?.message?.content?.trim();
        if (text) {
          return text;
        }
      }
    } catch (err) {
      console.warn('[generateAiReplyDraft Groq fallback]', err instanceof Error ? err.message : err);
    }
  }

  // High-quality contextual template generator (fallback)
  const lastCustomerMessage = [...history].reverse().find(m => m.sender_type === 'customer')?.body || '';
  const isReturnInquiry = /return|refund|exchange|broken|damaged|wrong item/i.test(lastCustomerMessage);
  const isPricingInquiry = /price|cost|quote|fee|rate|package|estimate/i.test(lastCustomerMessage);
  const isHoursInquiry = /hour|open|available|time|appointment|schedule|today/i.test(lastCustomerMessage);

  let draftBody = `Dear ${customerName},\n\nThank you for contacting ${businessName}. `;

  const matchedService = (settings.knowledge?.services || []).find((s) =>
    lastCustomerMessage.toLowerCase().includes(s.name.toLowerCase()) ||
    (conversation.subject && conversation.subject.toLowerCase().includes(s.name.toLowerCase()))
  );

  if (industry === 'services' || (settings.knowledge?.services && settings.knowledge.services.length > 0)) {
    const hours = `${settings.working_hours?.start_time || '08:00'} - ${settings.working_hours?.end_time || '18:00'}`;
    const coverage = serviceAreasText ? ` serving ${serviceAreasText}` : '';
    
    if (matchedService) {
      const priceNotice = matchedService.price_type === 'quote_required'
        ? 'Custom quote required based on job scope'
        : matchedService.price_type === 'starting_at'
        ? `starting at $${matchedService.price || 0}`
        : `$${matchedService.price || 0}`;
      draftBody += `We received your inquiry regarding ${matchedService.name} (${priceNotice})${coverage}.\n\nOur team operates from ${hours} (${settings.timezone || 'UTC'}). We have logged your request in our dispatch queue and an owner/technician will follow up shortly to confirm appointment details and provide an exact estimate.`;
    } else {
      draftBody += `We received your service inquiry${coverage}.\n\nOur operating hours are ${hours} (${settings.timezone || 'UTC'}). Our team is reviewing your requirements and will reach out promptly with scheduling options and details.`;
    }

    if (policies.general_rules) {
      draftBody += `\n\nPlease note: ${policies.general_rules}`;
    }
  } else if (isReturnInquiry) {
    const returnDays = policies.return_window_days || 14;
    draftBody += `We have received your inquiry regarding your order. Under our company policy, returns and exchanges are eligible within ${returnDays} days of delivery.\n\nOur team is reviewing your details to ensure the quickest resolution. If you have any relevant photos or reference numbers, please feel free to share them.\n\nWe appreciate your patience while we assist you.`;
  } else if (isPricingInquiry) {
    draftBody += `We appreciate your interest in our services. Our team has received your request regarding pricing and options. We will provide you with a tailored overview in accordance with your specifications.\n\nPlease let us know if there are specific dates or requirements you would like us to consider.`;
  } else if (isHoursInquiry) {
    const hours = `${settings.working_hours?.start_time || '09:00'} - ${settings.working_hours?.end_time || '18:00'}`;
    draftBody += `Our operating hours are ${hours} (${settings.timezone || 'UTC'}). A representative will be delighted to coordinate with you.\n\nPlease feel free to let us know your preferred time slot.`;
  } else {
    draftBody += `We have logged your request into our priority queue. A team member is reviewing your inquiry and will follow up with full details shortly.\n\nThank you for your patience and for choosing ${businessName}.`;
  }

  draftBody += `\n\nWarm regards,\nCustomer Support Team\n${businessName}`;
  return draftBody;
}
