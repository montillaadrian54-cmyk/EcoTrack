import { sb } from "./common.js";

const button = document.querySelector("#testButton");
const result = document.querySelector("#result");

button.addEventListener("click", async () => {
  button.disabled = true;
  result.textContent = "Sending test SMS...";

  try {
    const { data, error } = await sb.functions.invoke("test-sms", {
      body: {},
    });

    if (error) {
      console.error("Full SMS error:", error);

      const details = await error.context?.json().catch(() => null);

      console.error("Server response:", details);

      result.textContent = JSON.stringify(
        {
          message: error.message,
          details,
        },
        null,
        2,
      );

      return;
    }

    result.textContent = JSON.stringify(data, null, 2);
    console.log("SMS test result:", data);
  } catch (err) {
    result.textContent = "Error: " + err.message;
    console.error(err);
  } finally {
    button.disabled = false;
  }
});
