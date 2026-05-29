const { analyzeCodebase } = require('./src/scanner');
const path = require('path');

async function testAnalysis() {
  try {
    console.log('Testing API documentation generator...');
    
    // Test with the sample Express API
    const samplePath = path.join(__dirname, 'samples', 'express-api');
    console.log('Analyzing sample Express API at:', samplePath);
    
    const result = analyzeCodebase(samplePath);
    
    console.log('\n=== ANALYSIS RESULTS ===');
    console.log('Title:', result.title);
    console.log('Version:', result.version);
    console.log('Description:', result.description);
    console.log('Base URL:', result.baseUrl);
    console.log('Files scanned:', result.files.length);
    console.log('Endpoints found:', result.endpoints.length);
    console.log('Data models found:', result.dataModels.length);
    
    console.log('\n=== ENDPOINTS ===');
    result.endpoints.forEach((ep, i) => {
      console.log(`${i + 1}. ${ep.method} ${ep.path}`);
      console.log(`   Summary: ${ep.summary}`);
      console.log(`   Auth Required: ${ep.authRequired}`);
      console.log(`   Controller: ${ep.controller || 'N/A'}`);
      console.log(`   Middleware: ${(ep.middleware || []).join(', ') || 'None'}`);
      console.log(`   Source: ${ep.sourceFile}:${ep.sourceLine}`);
      console.log('');
    });
    
    console.log('\n=== DATA MODELS ===');
    result.dataModels.forEach((model, i) => {
      console.log(`${i + 1}. ${model.name}`);
      console.log(`   Table: ${model.table}`);
      console.log(`   Fields: ${model.fields.length}`);
      console.log(`   Source: ${model.source}`);
      model.fields.forEach(field => {
        console.log(`     - ${field.name}: ${field.type} (${field.nullable ? 'nullable' : 'required'})`);
      });
      console.log('');
    });
    
    console.log('\n=== PROJECT INFO ===');
    console.log('Languages:', result.project.languages.join(', '));
    console.log('Frameworks:', result.project.frameworks.join(', '));
    
    console.log('\nTest completed successfully!');
    
  } catch (error) {
    console.error('Test failed:', error.message);
    console.error(error.stack);
  }
}

testAnalysis();