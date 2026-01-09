/**
 * Azure Communication Services (ACS) Phone Provider
 *
 * Microsoft's cloud communications platform with PSTN calling.
 * Can optionally integrate with Microsoft Teams.
 *
 * Pricing (as of 2025):
 * - Outbound PSTN: ~$0.012-0.014/min (USA)
 * - Inbound PSTN: ~$0.0085/min (USA)
 * - Phone numbers: ~$1/month
 *
 * Features:
 * - PSTN calling to regular phone numbers
 * - WebRTC and media streaming support
 * - Teams interoperability (optional)
 * - Similar API structure to Twilio/Telnyx
 */

import type { PhoneProvider, PhoneConfig } from './types.js';
import { createHmac, createHash } from 'crypto';

interface ACSCallResponse {
  callConnectionId: string;
  callConnectionState: string;
  serverCallId: string;
  callbackUri: string;
}

interface ACSErrorResponse {
  error: {
    code: string;
    message: string;
  };
}

export class ACSPhoneProvider implements PhoneProvider {
  readonly name = 'acs';
  private static readonly API_VERSION = '2023-01-15-preview';
  
  private connectionString: string | null = null;
  private endpoint: string | null = null;
  private accessKey: string | null = null;

  initialize(config: PhoneConfig): void {
    // ACS uses a connection string format or endpoint + access key
    // For simplicity, we'll accept connection string via authToken
    // and extract endpoint/key from it, or use accountSid as endpoint
    this.connectionString = config.authToken;
    
    // Parse connection string to extract endpoint and access key
    // Format: endpoint=https://xxx.communication.azure.com/;accesskey=xxx
    if (this.connectionString.includes('endpoint=')) {
      const endpointMatch = this.connectionString.match(/endpoint=([^;]+)/);
      const keyMatch = this.connectionString.match(/accesskey=([^;]+)/);
      
      if (endpointMatch && keyMatch) {
        this.endpoint = endpointMatch[1];
        this.accessKey = keyMatch[1];
      } else {
        throw new Error('Invalid ACS connection string format');
      }
    } else {
      // Alternative: accountSid as endpoint, authToken as access key
      this.endpoint = config.accountSid;
      this.accessKey = config.authToken;
    }

    console.log(`Phone provider: Azure Communication Services`);
  }

  async initiateCall(to: string, from: string, webhookUrl: string): Promise<string> {
    if (!this.endpoint || !this.accessKey) {
      throw new Error('ACS not initialized');
    }

    const url = `${this.endpoint}/calling/callConnections?api-version=${ACSPhoneProvider.API_VERSION}`;
    
    // Create call request body
    const requestBody = {
      targets: [
        {
          phoneNumber: to,
        },
      ],
      sourceCallerId: {
        phoneNumber: from,
      },
      callbackUri: webhookUrl,
      mediaStreamingConfiguration: {
        transportType: 'websocket',
        contentType: 'audio',
        audioChannelType: 'unmixed',
      },
    };

    const body = JSON.stringify(requestBody);

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...this.generateAuthHeaders('POST', url, body),
      },
      body,
    });

    if (!response.ok) {
      const error = await response.json() as ACSErrorResponse;
      throw new Error(
        `ACS call failed: ${response.status} ${error.error?.message || 'Unknown error'}`
      );
    }

    const data = await response.json() as ACSCallResponse;
    return data.callConnectionId;
  }

  /**
   * Start media streaming for ACS
   * ACS uses WebSocket-based media streaming
   */
  async startStreaming(callConnectionId: string, streamUrl: string): Promise<void> {
    if (!this.endpoint || !this.accessKey) {
      throw new Error('ACS not initialized');
    }

    // ACS media streaming is configured during call creation
    // This method is kept for interface compatibility
    // In practice, ACS sends streaming.started event to the webhook when ready
    console.log('ACS streaming configured during call creation');
  }

  /**
   * Hang up a call using ACS API
   */
  async hangup(callConnectionId: string): Promise<void> {
    if (!this.endpoint || !this.accessKey) {
      throw new Error('ACS not initialized');
    }

    const url = `${this.endpoint}/calling/callConnections/${callConnectionId}?api-version=${ACSPhoneProvider.API_VERSION}`;

    const response = await fetch(url, {
      method: 'DELETE',
      headers: this.generateAuthHeaders('DELETE', url),
    });

    if (!response.ok && response.status !== 404) {
      const errorText = await response.text();
      console.error(`ACS hangup failed: ${response.status} ${errorText}`);
    }
  }

  /**
   * Get XML/TwiML-like response for connecting media stream
   * ACS doesn't use TwiML - returns empty for compatibility
   */
  getStreamConnectXml(_streamUrl: string): string {
    // ACS doesn't use TwiML/XML responses
    // Media streaming is configured via API, not XML
    return '';
  }

  /**
   * Generate HMAC-SHA256 authentication headers for ACS REST API
   * 
   * ACS uses HMAC-SHA256 for request authentication:
   * 1. Create string to sign: METHOD\nPATH\nQUERY\nDATE\nHOST\nCONTENT_HASH
   * 2. Sign with access key using HMAC-SHA256
   * 3. Add Authorization header with signature
   * 
   * @see https://learn.microsoft.com/en-us/rest/api/communication/
   */
  private generateAuthHeaders(method: string, fullUrl: string, body?: string): Record<string, string> {
    if (!this.accessKey || !this.endpoint) {
      throw new Error('Access key or endpoint not available');
    }

    const url = new URL(fullUrl);
    const pathAndQuery = url.pathname + url.search;
    const host = url.host;
    const date = new Date().toUTCString();
    
    // Compute content hash (SHA256 of body, empty string if no body)
    const contentHash = body 
      ? createHash('sha256').update(body).digest('base64')
      : '';

    // Build string to sign
    const stringToSign = [
      method.toUpperCase(),
      pathAndQuery,
      date,
      host,
      contentHash,
    ].join('\n');

    // Sign with access key using HMAC-SHA256
    const decodedKey = Buffer.from(this.accessKey, 'base64');
    const signature = createHmac('sha256', decodedKey)
      .update(stringToSign)
      .digest('base64');

    // Build authorization header
    const authHeader = `HMAC-SHA256 SignedHeaders=date;host;x-ms-content-sha256&Signature=${signature}`;

    return {
      'x-ms-date': date,
      'x-ms-content-sha256': contentHash,
      'Authorization': authHeader,
    };
  }
}
