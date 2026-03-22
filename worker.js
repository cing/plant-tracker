export default {
  async fetch(request) {
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "POST",
          "Access-Control-Allow-Headers": "X-Plantnet-Key",
        },
      });
    }

    if (request.method !== "POST") {
      return new Response("Method not allowed", { status: 405 });
    }

    const apiKey = request.headers.get("X-Plantnet-Key");
    if (!apiKey) {
      return new Response(JSON.stringify({ message: "Missing API key" }), {
        status: 400,
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
      });
    }

    const formData = await request.formData();
    const plantnetRes = await fetch(
      `https://my-api.plantnet.org/v2/identify/all?api-key=${encodeURIComponent(apiKey)}&lang=en&nb-results=8`,
      { method: "POST", body: formData }
    );

    const data = await plantnetRes.json();
    return new Response(JSON.stringify(data), {
      status: plantnetRes.status,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
    });
  },
};
