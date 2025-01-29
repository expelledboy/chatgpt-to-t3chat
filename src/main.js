import { transformData } from "./transform.js";

class Converter {
  constructor() {
    this.fileInput = document.getElementById("fileInput");
    this.downloadBtn = document.getElementById("downloadBtn");
    this.statusElement = document.getElementById("status");
    this.uploadSection = document.querySelector(".upload-section");

    this.setupEventListeners();
  }

  setupEventListeners() {
    this.fileInput.addEventListener("change", (e) => this.handleFileSelect(e));
    this.downloadBtn.addEventListener("click", () => this.handleDownload());

    // Setup drag and drop
    const dropZone = document.querySelector(".upload-section");
    dropZone.addEventListener("dragover", (e) => {
      e.preventDefault();
      dropZone.classList.add("dragover");
    });

    dropZone.addEventListener("dragleave", () => {
      dropZone.classList.remove("dragover");
    });

    dropZone.addEventListener("drop", (e) => {
      e.preventDefault();
      dropZone.classList.remove("dragover");
      if (e.dataTransfer.files.length) {
        this.fileInput.files = e.dataTransfer.files;
        this.handleFileSelect({ target: this.fileInput });
      }
    });
  }

  updateStatus(message, isProcessing = false) {
    this.statusElement.innerHTML = `
      ${message}
      ${isProcessing ? '<div class="loader"></div>' : ""}
    `;
    this.statusElement.className = `status ${isProcessing ? "processing" : ""}`;
  }

  updateUploadSection(file) {
    const label = this.uploadSection.querySelector(".file-input-label span");
    if (file) {
      label.textContent = `Selected: ${file.name}`;
      this.uploadSection.classList.add("has-file");
    } else {
      label.textContent = "Choose ChatGPT export file or drag it here";
      this.uploadSection.classList.remove("has-file");
    }
  }

  async handleFileSelect(event) {
    const file = event.target.files[0];
    if (!file) {
      console.log("No file selected");
      return;
    }

    console.log("File selected:", file.name);
    this.updateUploadSection(file);
    this.downloadBtn.style.display = "none";

    try {
      // Check if it's a zip file by extension instead of type
      if (!file.name.toLowerCase().endsWith(".zip")) {
        throw new Error("Please upload a ZIP file");
      }

      console.log("Starting zip file processing");
      this.updateStatus("Reading zip file...", true);

      const zip = new JSZip();
      try {
        console.log("Loading zip file...");
        const zipContent = await zip.loadAsync(file);
        console.log("Zip file loaded");

        // Find conversations.json in the zip
        const conversationsFile = zipContent.file("conversations.json");
        if (!conversationsFile) {
          throw new Error("conversations.json not found in the zip file");
        }

        console.log("Found conversations.json");
        this.updateStatus("Reading conversations...", true);

        // Read and parse the JSON
        const jsonContent = await conversationsFile.async("string");
        let chatgptData;
        try {
          chatgptData = JSON.parse(jsonContent);
          console.log("Parsed JSON data, conversations:", chatgptData.length);
        } catch (e) {
          console.error("JSON parse error:", e);
          throw new Error("Invalid JSON format in conversations.json");
        }

        this.updateStatus(
          `Converting ${chatgptData.length} conversations...`,
          true
        );

        console.log("Starting transformation");
        const transformedData = transformData(chatgptData);
        console.log("Transformation complete");

        // Store the result for download
        this.transformedResult = transformedData;

        const totalMessages = transformedData.messages.length;
        const totalThreads = transformedData.threads.length;
        console.log(
          `Processed ${totalThreads} threads, ${totalMessages} messages`
        );

        this.updateStatus(
          `Conversion complete!<br>
          Processed ${totalThreads} conversations with ${totalMessages} messages.<br>
          Click the download button below to save.`
        );
        this.downloadBtn.style.display = "block";
      } catch (zipError) {
        console.error("Zip processing error:", zipError);
        if (zipError.message.includes("invalid")) {
          throw new Error("Invalid ZIP file format");
        }
        throw zipError;
      }
    } catch (error) {
      console.error("Main error handler:", error);
      this.updateStatus(`Error: ${error.message}`);
      console.error("Conversion error:", error);
      // Reset UI on error
      this.fileInput.value = "";
      this.updateUploadSection(null);
    }
  }

  handleDownload() {
    if (!this.transformedResult) return;

    const blob = new Blob([JSON.stringify(this.transformedResult, null, 2)], {
      type: "application/json",
    });

    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "t3chat_conversations.json";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    // Reset the UI
    this.fileInput.value = "";
    this.updateUploadSection(null);
  }
}

// Initialize the converter when the page loads
new Converter();
