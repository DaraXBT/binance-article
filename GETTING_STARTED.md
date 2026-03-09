# DeckForge - Getting Started Guide

Welcome to DeckForge! This guide will help you get up and running in minutes.

## Quick Start (5 minutes)

### 1. Get Your Gemini API Key

1. Go to [Google AI Studio](https://aistudio.google.com/app/apikey)
2. Click "Create API Key"
3. Copy the generated key

### 2. Set Up Environment Variables

The app already has `GEMINI_API_KEY` requested. You'll see a prompt in the settings to add it:

1. Click the settings button (⚙️) in the top right
2. Go to "Vars" section
3. Add your Gemini API key there

### 3. Install & Run

```bash
# Install dependencies
pnpm install

# Start the dev server
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

## Creating Your First Deck

### Step 1: Dashboard
- You'll see the main dashboard
- Click **"Create New Deck"** button

### Step 2: Content
- Enter a **presentation title**
- Describe the **topic** in detail
- Set the **number of slides** (recommended: 8-15)
- Click **Next**

### Step 3: Settings
- Add a **target audience** (optional)
- Choose a **presentation style**:
  - Professional: Corporate/Business
  - Creative: Dynamic/Artistic
  - Educational: Academic/Learning
  - Minimal: Clean/Simple
  - Storytelling: Narrative-driven
- Add any **special instructions** (optional)
- Click **Next**

### Step 4: Theme
- Select from **15+ built-in themes**
- Each theme has distinct colors and styling
- Click **Next**

### Step 5: Generate
- Watch the progress bar as AI generates:
  - Creating deck (25%)
  - Generating slides (75%)
  - Finalizing (100%)
- You'll be redirected to the studio automatically

## Using the Studio

The studio has 4 main sections:

### Left Panel: Slide List
- See all slides in your presentation
- Click to select a slide
- Scroll to navigate through many slides

### Center Panel: Slide Editor
- Edit slide **title**, **subtitle**, and **bullet points**
- Add **speaker notes** for presenting
- **Delete slide** button (if needed)
- Changes are auto-saved to the database

### Right Top: Live Preview
- See your slide with the selected theme in real-time
- Preview updates as you edit
- Shows proper 16:9 aspect ratio

### Right Bottom: Captions

**Blog Tab:**
- **SEO Title**: Optimized for search (≤60 chars)
- **Meta Description**: For website previews (≤160 chars)
- **Intro Text**: Opening paragraph for blog posts
- **Tags**: Suggested keywords
- **Copy buttons**: Copy any caption to clipboard

**Twitter/X Tab:**
- **Individual Tweets**: 3 single-post variations
- **Twitter Thread**: Formatted for multi-tweet threads
- **Copy buttons**: Ready to paste to social media

## Editing Tips

### Quick Edits
1. Click on any slide in the left panel
2. Edit the title, subtitle, or bullet points
3. See changes in real-time in the preview

### Slide Management
- **Add Slide**: Not yet implemented (coming soon)
- **Delete Slide**: Click the trash icon in the editor
- **Reorder**: Drag-and-drop functionality (coming soon)

### Caption Tips
- Blog captions are optimized for SEO
- Twitter content is pre-formatted for threading
- All copy is ready to paste directly into your publishing platform

## Common Workflows

### Creating a Pitch Deck
1. **Topic**: "Product launch for our new mobile app"
2. **Audience**: "Investors"
3. **Style**: "Professional"
4. **Theme**: "Modern Blue"
5. Generate and customize as needed

### Making a Tutorial
1. **Topic**: "How to use our software - step by step"
2. **Audience**: "New users"
3. **Style**: "Educational"
4. **Theme**: "Clean Minimal"
5. Edit to add specific steps and terms

### Creating Content
1. **Topic**: "Latest industry trends 2024"
2. **Audience**: "Social media followers"
3. **Style**: "Creative"
4. **Theme**: "Vibrant"
5. Use the Twitter captions for social sharing

## Keyboard Shortcuts

Coming soon! Currently using mouse/trackpad navigation.

## Data Storage

- All decks are saved to a local SQLite database
- For production, upgrade to PostgreSQL (see README.md)
- Assets are stored in `public/assets/`

## Troubleshooting

### "Failed to generate slides"
- Check that your Gemini API key is valid
- Verify you haven't exceeded API quota
- Try again in a few moments

### Slides not displaying
- Refresh the page
- Check browser console for errors
- Ensure JavaScript is enabled

### Performance Issues
- Large presentations (100+ slides) may take longer
- Try with 10-15 slides first
- Use Chrome or Firefox for best performance

## Next Steps

1. **Create your first deck** - Start with the "Create New Deck" button
2. **Explore themes** - Try different color schemes
3. **Edit content** - Customize the AI-generated slides
4. **Share captions** - Use the generated social media content
5. **Experiment** - Try different topics and styles

## Advanced Features (Future)

These features are coming soon:
- Custom fonts and styling
- Slide templates and gallery
- Collaborative editing
- Team workspaces
- Advanced rendering (PPTX, PDF export)
- Presentation mode with speaker notes
- Real-time collaboration
- Analytics and usage tracking

## Need Help?

- Check the full [README.md](./README.md) for technical details
- Review the project structure in the README
- Check the browser console for error messages
- Ensure your Gemini API key is valid

## Tips for Best Results

### Topic Description
Be specific and detailed. Instead of "AI", try "How AI is transforming healthcare in 2024"

### Slide Count
- 10 slides: Quick overview
- 15 slides: Comprehensive presentation
- 20+ slides: Deep dive / Tutorial

### Style Selection
- Professional: Business meetings, pitches
- Creative: Marketing, social media
- Educational: Webinars, training
- Minimal: Conferences, speaking
- Storytelling: Product launches, narratives

### Theme Selection
Choose themes that match your content:
- Blue/teal: Professional, tech, corporate
- Green: Nature, health, environment
- Red/orange: Energy, passion, creativity
- Purple: Innovation, luxury, creativity

## Happy Presenting! 🎉

Now go create amazing presentations with AI!
