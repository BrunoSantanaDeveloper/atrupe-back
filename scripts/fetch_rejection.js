const axios = require('axios');

async function getRejectionReason() {
  try {
    const api = axios.create({
      baseURL: 'https://api-homolog.atrupe.com.br' // Assuming this is the backend URL based on the frontend
    });

    // Login
    const loginRes = await api.post('/auth/login', {
      email: 'contig.um@gmail.com',
      password: 'Atrupe123@'
    });
    
    const token = loginRes.data.access_token || loginRes.data.token;
    console.log("Logged in successfully!");

    // Fetch notes
    const res = await api.get('/fiscal/emissions/nfe', {
      headers: { Authorization: `Bearer ${token}` }
    });

    const notes = res.data.data || res.data;
    if (notes && notes.length > 0) {
      console.log(`Found ${notes.length} notes.`);
      const rejected = notes.filter(n => n.status === 'Rejeitada' || n.status === 'REJECTED' || n.status === 'ERROR' || n.status === 'Erro');
      if (rejected.length > 0) {
        console.log("Most recent rejection reason:");
        console.log(rejected[0].statusReason || rejected[0].message || JSON.stringify(rejected[0], null, 2));
      } else {
        console.log("No rejected notes found.");
      }
    } else {
      console.log("No notes found.");
    }
  } catch (err) {
    console.error("Error:", err.response ? err.response.data : err.message);
  }
}

getRejectionReason();
