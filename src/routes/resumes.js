const express = require('express');
const router = express.Router();
const fs = require('fs');
const Resume = require('../models/Resume');
const { uploadResume } = require('../middleware/upload');

// POST /api/resumes (Upload PDF resume)
router.post('/', uploadResume.single('resume'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Please upload a PDF file.' });
    }

    const resume = await Resume.create({
      originalName: req.file.originalname,
      filename: req.file.filename,
      filepath: req.file.path,
      mimeType: req.file.mimetype,
      size: req.file.size,
    });

    res.status(201).json(resume);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/resumes
router.get('/', async (req, res) => {
  try {
    const resumes = await Resume.find().sort({ createdAt: -1 });
    res.json(resumes);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// DELETE /api/resumes/:id
router.delete('/:id', async (req, res) => {
  try {
    const resume = await Resume.findById(req.params.id);
    if (!resume) {
      return res.status(404).json({ error: 'Resume not found' });
    }

    // Delete disk file
    if (fs.existsSync(resume.filepath)) {
      try {
        fs.unlinkSync(resume.filepath);
      } catch (err) {
        console.warn(`[Resume] Could not delete disk file ${resume.filepath}:`, err.message);
      }
    }

    await Resume.findByIdAndDelete(req.params.id);
    res.json({ message: 'Resume deleted successfully', id: req.params.id });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;

