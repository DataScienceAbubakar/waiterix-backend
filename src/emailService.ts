import { Resend } from 'resend';

let connectionSettings: any;

async function getCredentials() {
  console.log('[Email Service] Fetching Resend credentials...');
  const hostname = process.env.REPLIT_CONNECTORS_HOSTNAME
  const xReplitToken = process.env.REPL_IDENTITY 
    ? 'repl ' + process.env.REPL_IDENTITY 
    : process.env.WEB_REPL_RENEWAL 
    ? 'depl ' + process.env.WEB_REPL_RENEWAL 
    : null;

  if (!xReplitToken) {
    console.error('[Email Service] No REPL_IDENTITY or WEB_REPL_RENEWAL token found');
    throw new Error('X_REPLIT_TOKEN not found for repl/depl');
  }

  console.log('[Email Service] Fetching connection from Replit API...');
  const url = 'https://' + hostname + '/api/v2/connection?include_secrets=true&connector_names=resend';
  
  const response = await fetch(url, {
    headers: {
      'Accept': 'application/json',
      'X_REPLIT_TOKEN': xReplitToken
    }
  });
  
  const data = await response.json();
  console.log('[Email Service] Connection API response:', {
    status: response.status,
    hasItems: !!data.items,
    itemCount: data.items?.length || 0
  });
  
  connectionSettings = data.items?.[0];

  if (!connectionSettings || (!connectionSettings.settings?.api_key)) {
    console.error('[Email Service] Resend not connected or API key missing', {
      hasConnectionSettings: !!connectionSettings,
      hasSettings: !!connectionSettings?.settings,
      hasApiKey: !!connectionSettings?.settings?.api_key
    });
    throw new Error('Resend not connected');
  }
  
  console.log('[Email Service] Credentials fetched successfully', {
    hasApiKey: !!connectionSettings.settings.api_key,
    hasFromEmail: !!connectionSettings.settings.from_email,
    fromEmail: connectionSettings.settings.from_email
  });
  
  return {apiKey: connectionSettings.settings.api_key, fromEmail: connectionSettings.settings.from_email};
}

async function getUncachableResendClient() {
  const credentials = await getCredentials();
  return {
    client: new Resend(credentials.apiKey),
    fromEmail: connectionSettings.settings.from_email
  };
}

interface SendEmailParams {
  to: string;
  subject: string;
  text?: string;
  html?: string;
}

export async function sendEmail({ to, subject, text, html }: SendEmailParams) {
  try {
    const { client, fromEmail } = await getUncachableResendClient();
    
    const emailOptions: any = {
      from: fromEmail,
      to,
      subject,
    };

    if (html) {
      emailOptions.html = html;
    }
    if (text) {
      emailOptions.text = text;
    }
    
    const result = await client.emails.send(emailOptions);

    console.log('[Email Service] Email sent successfully:', {
      to,
      subject,
      id: result.data?.id,
    });

    return { success: true, id: result.data?.id };
  } catch (error) {
    console.error('[Email Service] Failed to send email:', error);
    throw error;
  }
}

interface ReceiptEmailParams {
  to: string;
  orderNumber: string;
  restaurantName: string;
  items: Array<{ name: string; quantity: number; price: number }>;
  subtotal: number;
  tax: number;
  tip: number;
  total: number;
  paymentMethod: string;
  tableNumber?: string;
  timestamp: string;
}

export async function sendReceiptEmail(params: ReceiptEmailParams) {
  const itemsHtml = params.items
    .map(
      (item) => `
    <tr>
      <td style="padding: 8px; border-bottom: 1px solid #e5e7eb;">${item.name} x${item.quantity}</td>
      <td style="padding: 8px; border-bottom: 1px solid #e5e7eb; text-align: right;">$${item.price.toFixed(2)}</td>
    </tr>
  `
    )
    .join('');

  const html = `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Order Receipt - ${params.restaurantName}</title>
      </head>
      <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
        <div style="background-color: #f9fafb; border-radius: 8px; padding: 24px; margin-bottom: 20px;">
          <h1 style="color: #111827; margin: 0 0 8px 0; font-size: 24px;">Order Receipt</h1>
          <p style="color: #6b7280; margin: 0; font-size: 14px;">Thank you for your order!</p>
        </div>

        <div style="margin-bottom: 24px;">
          <h2 style="color: #374151; font-size: 18px; margin: 0 0 16px 0;">Order Details</h2>
          <table style="width: 100%; border-collapse: collapse; margin-bottom: 8px;">
            <tr>
              <td style="padding: 4px 0; color: #6b7280;">Order Number:</td>
              <td style="padding: 4px 0; text-align: right; font-weight: bold;">${params.orderNumber}</td>
            </tr>
            <tr>
              <td style="padding: 4px 0; color: #6b7280;">Restaurant:</td>
              <td style="padding: 4px 0; text-align: right;">${params.restaurantName}</td>
            </tr>
            ${params.tableNumber ? `
            <tr>
              <td style="padding: 4px 0; color: #6b7280;">Table:</td>
              <td style="padding: 4px 0; text-align: right;">Table ${params.tableNumber}</td>
            </tr>
            ` : ''}
            <tr>
              <td style="padding: 4px 0; color: #6b7280;">Date:</td>
              <td style="padding: 4px 0; text-align: right;">${params.timestamp}</td>
            </tr>
            <tr>
              <td style="padding: 4px 0; color: #6b7280;">Payment Method:</td>
              <td style="padding: 4px 0; text-align: right;">${params.paymentMethod}</td>
            </tr>
          </table>
        </div>

        <div style="margin-bottom: 24px;">
          <h2 style="color: #374151; font-size: 18px; margin: 0 0 16px 0;">Items Ordered</h2>
          <table style="width: 100%; border-collapse: collapse;">
            <thead>
              <tr style="background-color: #f9fafb;">
                <th style="padding: 8px; text-align: left; border-bottom: 2px solid #e5e7eb;">Item</th>
                <th style="padding: 8px; text-align: right; border-bottom: 2px solid #e5e7eb;">Price</th>
              </tr>
            </thead>
            <tbody>
              ${itemsHtml}
            </tbody>
          </table>
        </div>

        <div style="background-color: #f9fafb; border-radius: 8px; padding: 16px; margin-bottom: 20px;">
          <table style="width: 100%; border-collapse: collapse;">
            <tr>
              <td style="padding: 4px 0; color: #6b7280;">Subtotal:</td>
              <td style="padding: 4px 0; text-align: right;">$${params.subtotal.toFixed(2)}</td>
            </tr>
            <tr>
              <td style="padding: 4px 0; color: #6b7280;">Tax:</td>
              <td style="padding: 4px 0; text-align: right;">$${params.tax.toFixed(2)}</td>
            </tr>
            <tr>
              <td style="padding: 4px 0; color: #6b7280;">Tip:</td>
              <td style="padding: 4px 0; text-align: right;">$${params.tip.toFixed(2)}</td>
            </tr>
            <tr style="border-top: 2px solid #e5e7eb;">
              <td style="padding: 8px 0 0 0; font-weight: bold; font-size: 18px;">Total:</td>
              <td style="padding: 8px 0 0 0; text-align: right; font-weight: bold; font-size: 18px;">$${params.total.toFixed(2)}</td>
            </tr>
          </table>
        </div>

        <div style="text-align: center; color: #6b7280; font-size: 14px; padding-top: 20px; border-top: 1px solid #e5e7eb;">
          <p style="margin: 0;">This receipt was sent from ${params.restaurantName}</p>
          <p style="margin: 8px 0 0 0;">Powered by Waiterix</p>
        </div>
      </body>
    </html>
  `;

  const text = `
Order Receipt - ${params.restaurantName}

Order Number: ${params.orderNumber}
Restaurant: ${params.restaurantName}
${params.tableNumber ? `Table: ${params.tableNumber}\n` : ''}Date: ${params.timestamp}
Payment Method: ${params.paymentMethod}

Items Ordered:
${params.items.map((item) => `${item.name} x${item.quantity} - $${item.price.toFixed(2)}`).join('\n')}

Subtotal: $${params.subtotal.toFixed(2)}
Tax: $${params.tax.toFixed(2)}
Tip: $${params.tip.toFixed(2)}
Total: $${params.total.toFixed(2)}

This receipt was sent from ${params.restaurantName}
Powered by Waiterix
  `.trim();

  return sendEmail({
    to: params.to,
    subject: `Order Receipt #${params.orderNumber} - ${params.restaurantName}`,
    text,
    html,
  });
}

interface SupportEmailParams {
  restaurantName: string;
  restaurantId: string;
  userEmail: string;
  subject: string;
  message: string;
}

export async function sendSupportEmail(params: SupportEmailParams) {
  const supportEmail = 'support@harmoniaenterprisesllc.com';

  const html = `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Support Request - ${params.restaurantName}</title>
      </head>
      <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
        <div style="background-color: #f9fafb; border-radius: 8px; padding: 24px; margin-bottom: 20px;">
          <h1 style="color: #111827; margin: 0 0 8px 0; font-size: 24px;">Support Request from Waiterix Platform</h1>
          <p style="color: #6b7280; margin: 0; font-size: 14px;">New support request from a restaurant owner</p>
        </div>

        <div style="margin-bottom: 24px;">
          <h2 style="color: #374151; font-size: 18px; margin: 0 0 16px 0;">Restaurant Information</h2>
          <table style="width: 100%; border-collapse: collapse;">
            <tr>
              <td style="padding: 8px; background-color: #f9fafb; border: 1px solid #e5e7eb; font-weight: bold;">Restaurant Name:</td>
              <td style="padding: 8px; border: 1px solid #e5e7eb;">${params.restaurantName}</td>
            </tr>
            <tr>
              <td style="padding: 8px; background-color: #f9fafb; border: 1px solid #e5e7eb; font-weight: bold;">Restaurant ID:</td>
              <td style="padding: 8px; border: 1px solid #e5e7eb;">${params.restaurantId}</td>
            </tr>
            <tr>
              <td style="padding: 8px; background-color: #f9fafb; border: 1px solid #e5e7eb; font-weight: bold;">Contact Email:</td>
              <td style="padding: 8px; border: 1px solid #e5e7eb;"><a href="mailto:${params.userEmail}">${params.userEmail}</a></td>
            </tr>
          </table>
        </div>

        <div style="margin-bottom: 24px;">
          <h2 style="color: #374151; font-size: 18px; margin: 0 0 16px 0;">Support Request</h2>
          <div style="background-color: #f9fafb; border-radius: 8px; padding: 16px; border-left: 4px solid #3b82f6;">
            <h3 style="color: #111827; margin: 0 0 12px 0; font-size: 16px;">Subject: ${params.subject}</h3>
            <p style="color: #374151; margin: 0; white-space: pre-wrap;">${params.message}</p>
          </div>
        </div>

        <div style="text-align: center; color: #6b7280; font-size: 14px; padding-top: 20px; border-top: 1px solid #e5e7eb;">
          <p style="margin: 0;">This is an automated message from the Waiterix platform</p>
          <p style="margin: 8px 0 0 0;">Please respond directly to ${params.userEmail}</p>
        </div>
      </body>
    </html>
  `;

  const text = `
Support Request from Waiterix Platform

Restaurant Information:
- Restaurant Name: ${params.restaurantName}
- Restaurant ID: ${params.restaurantId}
- Contact Email: ${params.userEmail}

Support Request:
Subject: ${params.subject}

${params.message}

---
This is an automated message from the Waiterix platform.
Please respond directly to ${params.userEmail}
  `.trim();

  return sendEmail({
    to: supportEmail,
    subject: `[Waiterix Support] ${params.subject} - ${params.restaurantName}`,
    text,
    html,
  });
}
