import React, { useState, useCallback, useEffect, useRef } from 'react';
import { Upload, FileText, Download, Edit, Trash2, Eye, X, Loader2, Plus, Wifi, WifiOff } from 'lucide-react';
import { useMutation } from '@tanstack/react-query';

interface FileItem {
    id: number;
    name: string;
    size: number;
    type: string;
    status: 'uploaded' | 'queued' | 'processing' | 'completed' | 'error';
    file: File;
    jobId?: string;
    clientId?: string;
    progress?: string;
}

interface BoardMember {
    name: string;
    title: string | null;
}

interface ManagingDirector {
    name: string;
    business_unit: string;
}

interface ContactDetails {
    phone: string;
    fax: string;
    email: string;
}

interface CompanyAddress {
    street: string;
    city: string;
    province: string | null;
    postal_code: string;
    country: string;
}

interface Award {
    year: string;
    award: string;
    project: string | null;
}

interface Project {
    project_name: string;
    client: string;
    description: string;
}

interface ExtractedCompanyData {
    company_name: string;
    company_overview: string;
    company_website: string;
    company_address: CompanyAddress;
    contact_details: ContactDetails;
    board_of_directors: BoardMember[];
    managing_directors: ManagingDirector[];
    service_offerings: string[];
    association_memberships: string[];
    regional_offices: string[];
    international_offices: string[];
    vision: string;
    mission: string;
    ownership_structure: string;
    employment_equity_commitment: string;
    mentorship_training_programs: string;
    skills_transfer_initiatives: string;
    enterprise_development_activities: string;
    social_responsibility_projects: string;
    accolades: Award[];
    projects: Project[];
}

interface ApiResponse {
    job_id: string;
    client_id: string;
    status: string;
    message: string;
}

interface WebSocketMessage {
    job_id: string;
    status: string;
    message: string;
    timestamp: number;
    data?: {
        file: string;
        extracted: ExtractedCompanyData;
    };
}

interface ExtractedDataItem extends ExtractedCompanyData {
    id: number;
    fileName: string;
    extractedAt: string;
    status: 'extracted';
    industry?: string;
    employees?: string;
    established?: string;
}

const CompanyProfileExtractor: React.FC = () => {
    const [files, setFiles] = useState<FileItem[]>([]);
    const [extractedData, setExtractedData] = useState<ExtractedDataItem[]>([]);
    const [selectedItems, setSelectedItems] = useState<Set<number>>(new Set());
    const [activeTab, setActiveTab] = useState<'upload' | 'data'>('upload');
    const [wsConnected, setWsConnected] = useState(false);
    const [notifications, setNotifications] = useState<string[]>([]);

    const wsRef = useRef<WebSocket | null>(null);
    const clientIdRef = useRef<string>('');

    const API_URL = 'http://localhost:8000';
    const WSS_URL = 'ws://localhost:8000/ws';

    // Generate client ID on mount
    useEffect(() => {
        clientIdRef.current = Math.random().toString(36).substring(2, 15);
    }, []);

    // WebSocket connection
    useEffect(() => {
        const connectWebSocket = () => {
            if (clientIdRef.current) {
                const wsUrl = `${WSS_URL}/${clientIdRef.current}`;
                wsRef.current = new WebSocket(wsUrl);

                wsRef.current.onopen = () => {
                    console.log('WebSocket connected');
                    setWsConnected(true);
                };

                wsRef.current.onmessage = (event) => {
                    try {
                        const message: WebSocketMessage = JSON.parse(event.data);
                        handleWebSocketMessage(message);
                    } catch (error) {
                        console.error('Error parsing WebSocket message:', error);
                    }
                };

                wsRef.current.onclose = () => {
                    console.log('WebSocket disconnected');
                    setWsConnected(false);
                    // Attempt to reconnect after 3 seconds
                    setTimeout(connectWebSocket, 3000);
                };

                wsRef.current.onerror = (error) => {
                    console.error('WebSocket error:', error);
                    setWsConnected(false);
                };
            }
        };

        connectWebSocket();

        return () => {
            if (wsRef.current) {
                wsRef.current.close();
            }
        };
    }, []);

    const handleWebSocketMessage = (message: WebSocketMessage) => {
        const { job_id, status, message: statusMessage, data } = message;

        console.log('Received WebSocket message:', { job_id, status });

        // Update file status
        setFiles(prev => prev.map(file => {
            if (file.jobId === job_id) {
                return {
                    ...file,
                    status: status as FileItem['status'],
                    progress: statusMessage
                };
            }
            return file;
        }));

        // Add notification
        setNotifications(prev => [...prev.slice(-4), statusMessage].filter(Boolean));

        // If completed, add to extracted data
        if (status === 'completed' && data) {
            const extractedItem: ExtractedDataItem = {
                id: Date.now() + Math.random(),
                fileName: data.file,
                ...data.extracted,
                extractedAt: new Date().toISOString(),
                status: 'extracted',
                industry: deriveIndustry(data.extracted.service_offerings),
                employees: deriveEmployeeCount(data.extracted.company_overview),
                established: deriveEstablishedYear(data.extracted.company_overview),
            };

            setExtractedData(prev => [...prev, extractedItem]);
            setActiveTab('data');
        }
    };

    // TanStack Query mutation for file upload
    const uploadMutation = useMutation({
        mutationFn: async (file: File): Promise<ApiResponse> => {
            const formData = new FormData();
            formData.append('file', file);

            const response = await fetch(`${API_URL}/extract/${clientIdRef.current}`, {
                method: 'POST',
                body: formData,
            });

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            return response.json();
        },
        onSuccess: (data: ApiResponse, file: File) => {
            // Update file with job information
            setFiles(prev => prev.map(f =>
                f.file === file ? {
                    ...f,
                    status: 'queued',
                    jobId: data.job_id,
                    clientId: data.client_id,
                    progress: data.message
                } : f
            ));
        },
        onError: (error: Error, file: File) => {
            console.error('Upload failed:', error);
            setFiles(prev => prev.map(f =>
                f.file === file ? { ...f, status: 'error', progress: error.message } : f
            ));
        },
    });

    // Helper functions to derive display information
    const deriveIndustry = (serviceOfferings: string[]): string => {
        if (serviceOfferings.some(service => service.toLowerCase().includes('engineering'))) {
            return 'Engineering & Consulting';
        }
        if (serviceOfferings.some(service => service.toLowerCase().includes('construction'))) {
            return 'Construction';
        }
        return 'Professional Services';
    };

    const deriveEmployeeCount = (overview: string): string => {
        const match = overview.match(/(\d+)\s*(?:\+|\-|\s)*(?:technical|support|staff|employees)/i);
        return match ? `${match[1]}+ staff` : 'Not specified';
    };

    const deriveEstablishedYear = (overview: string): string => {
        const match = overview.match(/(?:established|founded|since)\s*(?:in\s*)?(\d{4})/i);
        return match ? match[1] : 'Not specified';
    };

    const formatAddress = (address: CompanyAddress): string => {
        return [address.street, address.city, address.province, address.postal_code, address.country]
            .filter(Boolean)
            .join(', ');
    };

    const getStatusColor = (status: FileItem['status']): string => {
        switch (status) {
            case 'uploaded': return 'bg-gray-100 text-gray-800';
            case 'queued': return 'bg-yellow-100 text-yellow-800';
            case 'processing': return 'bg-blue-100 text-blue-800';
            case 'completed': return 'bg-green-100 text-green-800';
            case 'error': return 'bg-red-100 text-red-800';
            default: return 'bg-gray-100 text-gray-800';
        }
    };

    const handleFileUpload = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
        const uploadedFiles = Array.from(event.target.files || []);
        const newFiles: FileItem[] = uploadedFiles.map(file => ({
            id: Date.now() + Math.random(),
            name: file.name,
            size: file.size,
            type: file.type,
            status: 'uploaded',
            file: file
        }));

        setFiles(prev => [...prev, ...newFiles]);
    }, []);

    const extractData = async (fileItem: FileItem) => {
        uploadMutation.mutate(fileItem.file);
    };

    const handleSelectAll = () => {
        if (selectedItems.size === extractedData.length) {
            setSelectedItems(new Set());
        } else {
            setSelectedItems(new Set(extractedData.map(item => item.id)));
        }
    };

    const handleSelectItem = (id: number) => {
        const newSelected = new Set(selectedItems);
        if (newSelected.has(id)) {
            newSelected.delete(id);
        } else {
            newSelected.add(id);
        }
        setSelectedItems(newSelected);
    };

    const deleteSelected = () => {
        setExtractedData(prev => prev.filter(item => !selectedItems.has(item.id)));
        setSelectedItems(new Set());
    };

    const exportData = () => {
        const selectedData = extractedData.filter(item => selectedItems.has(item.id));
        const dataStr = JSON.stringify(selectedData, null, 2);
        const dataBlob = new Blob([dataStr], { type: 'application/json' });
        const url = URL.createObjectURL(dataBlob);
        const link = document.createElement('a');
        link.href = url;
        link.download = 'company_profiles.json';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    };

    const dismissNotification = (index: number) => {
        setNotifications(prev => prev.filter((_, i) => i !== index));
    };

    return (
        <div className="min-h-screen bg-gray-50">
            {/* Notifications */}
            <div className="fixed top-4 right-4 space-y-2 z-50">
                {notifications.map((notification, index) => (
                    <div
                        key={index}
                        className="bg-white border border-gray-200 rounded-lg shadow-lg p-3 flex items-center justify-between min-w-96"
                    >
                        <p className="text-sm text-gray-900">{notification}</p>
                        <button
                            onClick={() => dismissNotification(index)}
                            className="ml-3 text-gray-400 hover:text-gray-600"
                        >
                            <X className="w-4 h-4" />
                        </button>
                    </div>
                ))}
            </div>

            {/* Header */}
            <div className="bg-white border-b border-gray-200">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                    <div className="flex justify-between items-center py-4">
                        <div className="flex items-center space-x-4">
                            <div className="w-8 h-8 bg-blue-600 rounded flex items-center justify-center">
                                <FileText className="w-5 h-5 text-white" />
                            </div>
                            <div>
                                <h1 className="text-xl font-semibold text-gray-900">Company Profile Extractor</h1>
                                <p className="text-sm text-gray-500">Extract and manage company data from PDF profiles</p>
                            </div>
                        </div>
                        <div className="flex items-center space-x-3">
                            {/* WebSocket Status Indicator */}
                            <div className="flex items-center space-x-2">
                                {wsConnected ? (
                                    <Wifi className="w-5 h-5 text-green-500" />
                                ) : (
                                    <WifiOff className="w-5 h-5 text-red-500" />
                                )}
                                <span className={`text-sm ${wsConnected ? 'text-green-600' : 'text-red-600'}`}>
                                    {wsConnected ? 'Connected' : 'Disconnected'}
                                </span>
                            </div>

                            {selectedItems.size > 0 && (
                                <>
                                    <button
                                        onClick={exportData}
                                        className="inline-flex items-center px-3 py-2 border border-gray-300 shadow-sm text-sm leading-4 font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
                                    >
                                        <Download className="w-4 h-4 mr-2" />
                                        Export ({selectedItems.size})
                                    </button>
                                    <button
                                        onClick={deleteSelected}
                                        className="inline-flex items-center px-3 py-2 border border-red-300 shadow-sm text-sm leading-4 font-medium rounded-md text-red-700 bg-white hover:bg-red-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500"
                                    >
                                        <Trash2 className="w-4 h-4 mr-2" />
                                        Delete ({selectedItems.size})
                                    </button>
                                </>
                            )}
                        </div>
                    </div>
                </div>
            </div>

            {/* Tabs */}
            <div className="bg-white border-b border-gray-200">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                    <nav className="-mb-px flex space-x-8">
                        <button
                            onClick={() => setActiveTab('upload')}
                            className={`py-4 px-1 border-b-2 font-medium text-sm ${activeTab === 'upload'
                                ? 'border-blue-500 text-blue-600'
                                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                                }`}
                        >
                            Upload Files ({files.length})
                        </button>
                        <button
                            onClick={() => setActiveTab('data')}
                            className={`py-4 px-1 border-b-2 font-medium text-sm ${activeTab === 'data'
                                ? 'border-blue-500 text-blue-600'
                                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                                }`}
                        >
                            Extracted Data ({extractedData.length})
                        </button>
                    </nav>
                </div>
            </div>

            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
                {activeTab === 'upload' && (
                    <div className="space-y-6">
                        {/* Upload Area */}
                        <div className="bg-white rounded-lg shadow">
                            <div className="px-6 py-4 border-b border-gray-200">
                                <h2 className="text-lg font-medium text-gray-900">Upload Company Profiles</h2>
                                <p className="text-sm text-gray-500">Upload PDF files to extract company information</p>
                            </div>
                            <div className="p-6">
                                <div className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center hover:border-gray-400 transition-colors">
                                    <Upload className="mx-auto h-12 w-12 text-gray-400" />
                                    <div className="mt-4">
                                        <label htmlFor="file-upload" className="cursor-pointer">
                                            <span className="mt-2 block text-sm font-medium text-gray-900">
                                                Drop files here or click to browse
                                            </span>
                                            <span className="mt-1 block text-sm text-gray-500">
                                                PDF files up to 10MB
                                            </span>
                                        </label>
                                        <input
                                            id="file-upload"
                                            name="file-upload"
                                            type="file"
                                            multiple
                                            accept=".pdf"
                                            className="sr-only"
                                            onChange={handleFileUpload}
                                        />
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Uploaded Files */}
                        {files.length > 0 && (
                            <div className="bg-white rounded-lg shadow">
                                <div className="px-6 py-4 border-b border-gray-200">
                                    <h3 className="text-lg font-medium text-gray-900">Uploaded Files</h3>
                                </div>
                                <div className="divide-y divide-gray-200">
                                    {files.map((file) => (
                                        <div key={file.id} className="px-6 py-4 flex items-center justify-between">
                                            <div className="flex items-center space-x-3">
                                                <FileText className="w-6 h-6 text-blue-500" />
                                                <div>
                                                    <p className="text-sm font-medium text-gray-900">{file.name}</p>
                                                    <p className="text-sm text-gray-500">
                                                        {(file.size / 1024 / 1024).toFixed(2)} MB
                                                    </p>
                                                    {file.progress && (
                                                        <p className="text-xs text-blue-600 mt-1">{file.progress}</p>
                                                    )}
                                                </div>
                                            </div>
                                            <div className="flex items-center space-x-2">
                                                <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${getStatusColor(file.status)}`}>
                                                    {file.status === 'processing' && <Loader2 className="w-3 h-3 mr-1 animate-spin" />}
                                                    {file.status}
                                                </span>
                                                {file.status === 'uploaded' && (
                                                    <button
                                                        onClick={() => extractData(file)}
                                                        disabled={uploadMutation.isPending}
                                                        className="inline-flex items-center px-3 py-1 border border-blue-300 shadow-sm text-xs leading-4 font-medium rounded-md text-blue-700 bg-white hover:bg-blue-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50"
                                                    >
                                                        {uploadMutation.isPending ? (
                                                            <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                                                        ) : (
                                                            <Plus className="w-3 h-3 mr-1" />
                                                        )}
                                                        Extract
                                                    </button>
                                                )}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>
                )}

                {activeTab === 'data' && (
                    <div className="bg-white rounded-lg shadow">
                        <div className="px-6 py-4 border-b border-gray-200">
                            <div className="flex items-center justify-between">
                                <h2 className="text-lg font-medium text-gray-900">Extracted Company Data</h2>
                                {extractedData.length > 0 && (
                                    <div className="flex items-center space-x-3">
                                        <span className="text-sm text-gray-500">
                                            {selectedItems.size} of {extractedData.length} selected
                                        </span>
                                    </div>
                                )}
                            </div>
                        </div>

                        {extractedData.length === 0 ? (
                            <div className="p-8 text-center">
                                <FileText className="mx-auto h-12 w-12 text-gray-400" />
                                <h3 className="mt-4 text-sm font-medium text-gray-900">No data extracted yet</h3>
                                <p className="mt-2 text-sm text-gray-500">
                                    Upload and process PDF files to see extracted company data here
                                </p>
                            </div>
                        ) : (
                            <div className="overflow-x-auto">
                                <table className="min-w-full divide-y divide-gray-200">
                                    <thead className="bg-gray-50">
                                        <tr>
                                            <th scope="col" className="px-6 py-3 text-left">
                                                <input
                                                    type="checkbox"
                                                    checked={selectedItems.size === extractedData.length && extractedData.length > 0}
                                                    onChange={handleSelectAll}
                                                    className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                                                />
                                            </th>
                                            <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                                Company
                                            </th>
                                            <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                                Industry
                                            </th>
                                            <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                                Location
                                            </th>
                                            <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                                Employees
                                            </th>
                                            <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                                Contact
                                            </th>
                                            <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                                Actions
                                            </th>
                                        </tr>
                                    </thead>
                                    <tbody className="bg-white divide-y divide-gray-200">
                                        {extractedData.map((item) => (
                                            <tr key={item.id} className={selectedItems.has(item.id) ? 'bg-blue-50' : 'hover:bg-gray-50'}>
                                                <td className="px-6 py-4 whitespace-nowrap">
                                                    <input
                                                        type="checkbox"
                                                        checked={selectedItems.has(item.id)}
                                                        onChange={() => handleSelectItem(item.id)}
                                                        className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                                                    />
                                                </td>
                                                <td className="px-6 py-4">
                                                    <div className="flex items-center">
                                                        <div className="flex-shrink-0 h-10 w-10">
                                                            <div className="h-10 w-10 rounded-full bg-blue-500 flex items-center justify-center">
                                                                <span className="text-sm font-medium text-white">
                                                                    {item.company_name.charAt(0)}
                                                                </span>
                                                            </div>
                                                        </div>
                                                        <div className="ml-4">
                                                            <div className="text-sm font-medium text-gray-900">{item.company_name}</div>
                                                            <div className="text-sm text-gray-500">Est. {item.established}</div>
                                                        </div>
                                                    </div>
                                                </td>
                                                <td className="px-6 py-4 whitespace-nowrap">
                                                    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                                                        {item.industry}
                                                    </span>
                                                </td>
                                                <td className="px-6 py-4 text-sm text-gray-900">
                                                    <div className="max-w-xs truncate">{formatAddress(item.company_address)}</div>
                                                </td>
                                                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                                                    {item.employees}
                                                </td>
                                                <td className="px-6 py-4 text-sm text-gray-900">
                                                    <div>{item.contact_details.phone}</div>
                                                    <div className="text-gray-500">{item.company_website}</div>
                                                </td>
                                                <td className="px-6 py-4 whitespace-nowrap text-sm font-medium space-x-2">
                                                    <button className="text-blue-600 hover:text-blue-900">
                                                        <Eye className="w-4 h-4" />
                                                    </button>
                                                    <button className="text-gray-600 hover:text-gray-900">
                                                        <Edit className="w-4 h-4" />
                                                    </button>
                                                    <button
                                                        onClick={() => {
                                                            setExtractedData(prev => prev.filter(d => d.id !== item.id));
                                                            setSelectedItems(prev => {
                                                                const newSet = new Set(prev);
                                                                newSet.delete(item.id);
                                                                return newSet;
                                                            });
                                                        }}
                                                        className="text-red-600 hover:text-red-900"
                                                    >
                                                        <Trash2 className="w-4 h-4" />
                                                    </button>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
};

export default CompanyProfileExtractor;