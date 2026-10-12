-- Starter learning catalogue for the first usable release.
-- These are editable topic starters, not a claim to be the complete official GES syllabus.
WITH seed(subject_code, title, description, level, sort_order) AS (
  VALUES
    ('MATH','Sets and set operations','Represent sets and solve union, intersection and complement problems.','SHS 1',10),
    ('MATH','Number bases','Convert numbers between bases and perform basic operations.','SHS 1',20),
    ('MATH','Fractions, ratios and percentages','Solve practical problems involving proportional reasoning.','SHS 1',30),
    ('MATH','Algebraic expressions','Simplify expressions, expand brackets and factorise.','SHS 1',40),
    ('MATH','Linear equations and inequalities','Solve equations and inequalities and interpret solutions.','SHS 1',50),
    ('MATH','Quadratic equations','Factorise and solve quadratic equations and interpret roots.','SHS 2',60),
    ('MATH','Plane geometry','Use angle facts, triangles, polygons and circle properties.','SHS 1',70),
    ('MATH','Statistics and probability','Summarise data and calculate basic probabilities.','SHS 2',80),
    ('ENG','Comprehension skills','Identify main ideas, inference, tone and supporting details.','SHS 1',10),
    ('ENG','Summary writing','Select relevant points and express them concisely in your own words.','SHS 2',20),
    ('ENG','Grammar and concord','Apply subject-verb agreement, tense and sentence structure.','SHS 1',30),
    ('ENG','Vocabulary and idioms','Use context clues, word relationships and idiomatic expressions.','SHS 1',40),
    ('ENG','Formal and informal letters','Plan and write letters suited to audience and purpose.','SHS 2',50),
    ('ENG','Argumentative and expository essays','Build a clear thesis, organised paragraphs and supported conclusions.','SHS 2',60),
    ('SCI','Scientific method and measurement','Form hypotheses, identify variables and use SI units.','SHS 1',10),
    ('SCI','Cells and organisation','Compare plant and animal cells and explain specialised structures.','SHS 1',20),
    ('SCI','Nutrition and digestion','Describe nutrients, balanced diets and human digestion.','SHS 1',30),
    ('SCI','Matter and mixtures','Distinguish states of matter and select separation techniques.','SHS 1',40),
    ('SCI','Acids, bases and salts','Compare common properties and explain neutralisation.','SHS 2',50),
    ('SCI','Force, work and energy','Apply basic relationships involving force, work, power and energy.','SHS 1',60),
    ('SCI','Electricity and simple circuits','Explain current, voltage, resistance and safe circuit use.','SHS 2',70),
    ('SOC','The environment and sanitation','Explain environmental challenges and practical community responses.','SHS 1',10),
    ('SOC','Citizenship and human rights','Discuss civic responsibilities, rights and the rule of law.','SHS 1',20),
    ('SOC','Governance in Ghana','Describe democratic institutions, participation and accountability.','SHS 2',30),
    ('SOC','Population and development','Interpret population patterns and links to development.','SHS 2',40),
    ('EMATH','Functions and graphs','Use function notation, domains, ranges and graph interpretation.','SHS 2',10),
    ('EMATH','Indices and logarithms','Apply laws of indices and logarithms to simplify expressions.','SHS 2',20),
    ('EMATH','Trigonometric ratios and identities','Solve right-triangle problems and use standard identities.','SHS 2',30),
    ('EMATH','Differentiation','Differentiate elementary functions and interpret gradients.','SHS 3',40),
    ('EMATH','Vectors','Represent vectors and perform basic vector operations.','SHS 2',50),
    ('ICT','Computer hardware and software','Explain computer components, operating systems and applications.','SHS 1',10),
    ('ICT','Data representation','Explain binary data and basic digital representation.','SHS 1',20),
    ('ICT','Networks and internet safety','Describe network concepts, safe browsing and account protection.','SHS 2',30),
    ('ICT','Spreadsheets and data handling','Use formulas, functions, sorting and charts to analyse data.','SHS 1',40),
    ('ICT','Algorithms and programming basics','Represent problem-solving steps using algorithms and simple code.','SHS 2',50)
)
INSERT INTO topics(subject_id, title, description, level, sort_order)
SELECT s.id, seed.title, seed.description, seed.level, seed.sort_order
FROM seed
JOIN subjects s ON s.code = seed.subject_code
ON CONFLICT (subject_id, title) DO NOTHING;
