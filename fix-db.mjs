
const supabaseUrl = 'https://yrjjajjmhirwkgldulzl.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlyamphamptaGlyd2tnbGR1bHpsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUxNTc3MTMsImV4cCI6MjA5MDczMzcxM30.Ez7L9WCL4gtBlJBQvNcC97RcSpOXrYwW_91iVcpTHnU';

async function fixProfile() {
    console.log('Updating profile with WhatsApp number...');
    const url = `${supabaseUrl}/rest/v1/profiles?id=eq.cdd85508-4e78-4858-b117-e5cfbc690b54`;
    const response = await fetch(url, {
        method: 'PATCH',
        headers: {
            'apikey': supabaseKey,
            'Authorization': `Bearer ${supabaseKey}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ whatsapp_number: '15705356119' })
    });

    if (!response.ok) {
        const text = await response.text();
        console.error('Error updating profile:', text);
    } else {
        console.log('Success! Your profile is now linked to 15705356119.');
    }
}
fixProfile();
